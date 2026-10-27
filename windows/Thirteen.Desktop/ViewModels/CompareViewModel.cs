using System.ComponentModel;
using System.Globalization;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// Compare (SPEC 5.4): 12 vs 13 for one year: month-boundary ribbon, month-length bars, Friday the 13ths,
/// quarter lengths, month shapes, weekday drift and the three calendars side by side.
/// </summary>
public sealed class CompareViewModel : PageViewModel
{
    private int _year;
    private CompareContent _content;

    /// <summary>Creates the page on the current year.</summary>
    public CompareViewModel(MainViewModel shell) : base(shell, AppSection.Compare)
    {
        _year = State.Today.Year;
        _content = Build();
        PreviousYearCommand = new RelayCommand(() => Year--, () => Year > GregorianDate.MinYear);
        NextYearCommand = new RelayCommand(() => Year++, () => Year < GregorianDate.MaxYear);
        OpenHistoryCommand = new RelayCommand(() => Shell.Section = AppSection.History);
        State.PropertyChanged += OnStateChanged;
    }

    /// <summary>The Gregorian year compared.</summary>
    public int Year
    {
        get => _year;
        set
        {
            value = MainViewModel.ClampYear(value);
            if (!SetProperty(ref _year, value)) return;
            Content = Build();
            PreviousYearCommand.NotifyCanExecuteChanged();
            NextYearCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>Everything the page shows for the year.</summary>
    public CompareContent Content
    {
        get => _content;
        private set => SetProperty(ref _content, value);
    }

    /// <summary>Previous year.</summary>
    public RelayCommand PreviousYearCommand { get; }

    /// <summary>Next year.</summary>
    public RelayCommand NextYearCommand { get; }

    /// <summary>Opens History.</summary>
    public RelayCommand OpenHistoryCommand { get; }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppState.System) or nameof(AppState.Today)) Content = Build();
    }

    private CompareContent Build() => new(_year, State.System, State.Today);
}

/// <summary>A big number with a caption (one per calendar) and the calendar's colour under it.</summary>
public sealed record StatFigure(string Value, string Caption, bool IsAccent);

/// <summary>One quarter: its length and whether it uses the stronger tone.</summary>
public sealed record QuarterCell(string Days, bool IsStrong, string AutomationName);

/// <summary>A row of quarter lengths.</summary>
public sealed record QuarterRow(string Title, bool IsAccent, IReadOnlyList<QuarterCell> Quarters);

/// <summary>A Gregorian month silhouette.</summary>
public sealed record ShapeGlyph(int LeadingBlanks, int Days, string Label);

/// <summary>One year of the weekday-drift strip.</summary>
public sealed record DriftYear(string Year, string Gregorian, string Thirteen);

/// <summary>A labelled fact of a calendar in the side-by-side card.</summary>
public sealed record FactLine(string Title, string Value);

/// <summary>One calendar in the side-by-side card.</summary>
public sealed record CalendarColumn(string Name, string Origin, IReadOnlyList<FactLine> Facts, bool IsSelected, bool IsFoil, string AutomationName)
{
    /// <summary>Neither the Gregorian (foil) nor the selected system (accent): drawn in secondary ink.</summary>
    public bool IsPlain => !IsFoil && !IsSelected;
}

/// <summary>Everything Compare shows for one year and system.</summary>
public sealed class CompareContent
{
    /// <summary>Builds the comparison of <paramref name="year"/>.</summary>
    public CompareContent(int year, CalendarSystemId system, GregorianDate today)
    {
        var inv = CultureInfo.InvariantCulture;
        var stats = new YearStats(year, system);
        var shortName = system.ShortName();
        Stats = stats;
        Alignment = new MonthAlignment(year, system);
        MarkedDayOfYear = today.Year == year ? today.DayOfYear : null;
        Header = new YearHeaderModel(year, system, "12 vs 13");
        SystemShortName = shortName;
        HasToday = MarkedDayOfYear is not null;

        RibbonLegendThirteen = $"{shortName} month";
        RibbonAutomationName = $"Month boundaries, {year.ToString(inv)}: 12 Gregorian months of 28 to 31 days above 13 {shortName} months of 28 days. "
            + string.Join(". ", Alignment.GregorianMonths.Select(s =>
                $"Gregorian {s.MonthInfo.Name}: {s.Length.ToString(inv)} days, {s.Start.Format(FormatOptions.Short)} to {s.End.Format(FormatOptions.Short)} in {shortName}"))
            + ". "
            + string.Join(". ", Alignment.ThirteenMonths.Select(s =>
                $"{shortName} {s.MonthInfo.Name}: 28 days, Gregorian {s.Start.Format(FormatOptions.Short)} to {s.End.Format(FormatOptions.Short)}"))
            + ". "
            + string.Join(". ", Alignment.Intercalary.Select(d => $"{d.Name}: Gregorian {d.Gregorian.Format(FormatOptions.Short)}, outside any month"));

        GregorianChartTitle = "Gregorian · 12 months of 28 to 31 days";
        ThirteenChartTitle = $"{shortName} · 13 months of exactly 28";
        GregorianMonthNames = GregorianMonthInfo.All.Select(m => m.Name).ToArray();
        ThirteenMonthNames = system.Months().Select(m => m.Name).ToArray();
        GregorianMonthShortNames = GregorianMonthInfo.All.Select(m => m.ShortName).ToArray();
        ThirteenMonthShortNames = system.Months().Select(m => m.ShortName).ToArray();
        GregorianChartAutomationName = "Gregorian month lengths: " + string.Join(", ",
            GregorianMonthInfo.All.Select(m => $"{m.Name} {Phrasing.Days(stats.GregorianMonthLengths[m.Index - 1])}"));
        ThirteenChartAutomationName = $"{shortName} month lengths: every month {Phrasing.Days(28)}";

        // Friday the 13th.
        var gregorianFridays = string.Join(", ", stats.GregorianFriday13ths.Select(f => f.Gregorian.Format(FormatOptions.Short)));
        FridayGregorian = new StatFigure(stats.GregorianFriday13ths.Count.ToString(inv), $"Gregorian: {gregorianFridays}", IsAccent: false);
        FridayThirteen = new StatFigure(
            stats.ThirteenFriday13ths.Count.ToString(inv),
            stats.ThirteenFriday13ths.Count == 0
                ? $"{shortName}: never, since every 13th is a {system.FixedWeekday(13).Name()}"
                : $"{shortName}: every month, every year",
            IsAccent: true);

        // Quarters.
        Quarters =
        [
            Quarter("GREGORIAN", stats.GregorianQuarterLengths, accent: false),
            Quarter(shortName.ToUpperInvariant(), stats.ThirteenQuarterLengths, accent: true),
        ];
        QuartersNote = stats.IntercalaryDayCount > 0 ? $"Plus {Phrasing.Days(stats.IntercalaryDayCount)} outside the 13-month quarters." : null;

        // Month shapes.
        ShapesGregorian = new StatFigure(stats.GregorianMonthShapeCount.ToString(inv), "distinct Gregorian shapes this year", IsAccent: false);
        ShapesThirteen = new StatFigure(stats.ThirteenMonthShapeCount.ToString(inv), "13-month shape, forever", IsAccent: true);
        Shapes = Enumerable.Range(1, 12).Select(m =>
        {
            var layout = new GregorianMonthLayout(year, m, system);
            return new ShapeGlyph(layout.LeadingBlanks, layout.Days.Count(), layout.MonthInfo.ShortName);
        }).ToArray();
        ShapesNote = $"Every {shortName} month: four full weeks, starting {system.WeekStartsOn().Name()}.";

        // Weekday drift: New Year's Day over seven years.
        DriftYears = Enumerable.Range(year, Math.Min(7, GregorianDate.MaxYear - year + 1)).Select(y => new DriftYear(
            Phrasing.DisplayYear(y, system),
            Chip(new GregorianDate(y, 1, 1).Weekday),
            Chip(system.WeekStartsOn()))).ToArray();
        DriftSystemLabel = (shortName.Length > 5 ? shortName[..5] : shortName).ToUpperInvariant();
        DriftSentence = $"Gregorian years start one weekday later each year (two after a leap year). Every {shortName} year starts on a {system.WeekStartsOn().Name()}.";
        DriftAutomationName = "Weekday of 1 January: " + string.Join(", ", DriftYears.Select(d => $"{d.Year} Gregorian {Expand(d.Gregorian)}")) + ". " + DriftSentence;

        // Side by side.
        var gregorian = GregorianCalendarInfo.Gregorian;
        var columns = new List<CalendarColumn>
        {
            Column(gregorian.Name, gregorian.Inventor, gregorian.ProposedYear,
            [
                new FactLine("MONTHS", "12, of 28 to 31 days"),
                new FactLine("WEEKS", "Run across months; dates drift by weekday every year"),
                new FactLine("LEAP DAY", "29 February"),
                new FactLine("YEAR NUMBER", "Anno Domini"),
            ], selected: false, foil: true),
        };
        foreach (var definition in CalendarSystem.All)
        {
            var intercalary = string.Join(" and ", definition.IntercalaryDays.Select(d => d.Name));
            var leap = definition.IntercalaryDays.FirstOrDefault(d => d.LeapOnly);
            var leapText = leap is null
                ? "None"
                : leap.AfterMonth == ThirteenDate.MonthsPerYear
                    ? $"{leap.Name}, at the end of leap years"
                    : $"{leap.Name}, after {definition.Months[leap.AfterMonth - 1].Name} 28";
            var yearNumber = definition.YearOffset == 0
                ? "Gregorian year"
                : $"Gregorian year minus {(-definition.YearOffset).ToString(inv)} (year 1 = {(1 - definition.YearOffset).ToString(inv)})";
            columns.Add(Column(definition.Name, definition.Inventor, definition.ProposedYear,
            [
                new FactLine("MONTHS", $"13 × 28 days: {string.Join(" ", definition.Months.Select(m => m.ShortName))}"),
                new FactLine("WEEKS", $"Every month starts on {definition.WeekStartsOn.Name()}; dates keep their weekday forever"),
                new FactLine("OUTSIDE THE WEEK", intercalary),
                new FactLine("LEAP DAY", leapText),
                new FactLine("YEAR NUMBER", yearNumber),
            ], selected: definition.Id == system, foil: false));
        }
        Columns = columns;
    }

    private static CalendarColumn Column(string name, string inventor, int year, IReadOnlyList<FactLine> facts, bool selected, bool foil)
    {
        name = DisplayText.WithoutDashes(name);
        var origin = $"{DisplayText.WithoutDashes(inventor)}, {year.ToString(CultureInfo.InvariantCulture)}";
        var automation = $"{name}{(selected ? ", selected" : "")}. {origin}. " + string.Join(". ", facts.Select(f => $"{Title(f.Title)}: {f.Value}"));
        return new CalendarColumn(name, origin, facts, selected, foil, automation);
    }

    private static string Title(string upper) => upper[..1] + upper[1..].ToLowerInvariant();

    private static QuarterRow Quarter(string title, IReadOnlyList<int> lengths, bool accent) =>
        new(title, accent, lengths.Select((days, i) => new QuarterCell(
            days.ToString(CultureInfo.InvariantCulture), i % 2 == 1,
            $"Quarter {(i + 1).ToString(CultureInfo.InvariantCulture)}: {Phrasing.Days(days)}")).ToArray());

    private static string Chip(Weekday weekday) => weekday.Name(NameStyle.Short)[..2].ToUpperInvariant();

    private static string Expand(string chip) =>
        Weekdays.All.First(w => w.Name(NameStyle.Short)[..2].Equals(chip, StringComparison.OrdinalIgnoreCase)).Name();

    /// <summary>The year's statistics (month-length charts).</summary>
    public YearStats Stats { get; }

    /// <summary>Month boundaries of both calendars (ribbon).</summary>
    public MonthAlignment Alignment { get; }

    /// <summary>Today's day of year when the year is the current one.</summary>
    public int? MarkedDayOfYear { get; }

    /// <summary>Whether the ribbon marks today.</summary>
    public bool HasToday { get; }

    /// <summary>The big year and its caption.</summary>
    public YearHeaderModel Header { get; }

    /// <summary>"IFC".</summary>
    public string SystemShortName { get; }

    /// <summary>"IFC month" (legend).</summary>
    public string RibbonLegendThirteen { get; }

    /// <summary>Every boundary in words, for screen readers.</summary>
    public string RibbonAutomationName { get; }

    /// <summary>"Gregorian · 12 months of 28 to 31 days".</summary>
    public string GregorianChartTitle { get; }

    /// <summary>"IFC · 13 months of exactly 28".</summary>
    public string ThirteenChartTitle { get; }

    /// <summary>Full Gregorian month names (chart readout).</summary>
    public IReadOnlyList<string> GregorianMonthNames { get; }

    /// <summary>Full 13-month names (chart readout).</summary>
    public IReadOnlyList<string> ThirteenMonthNames { get; }

    /// <summary>"Jan", "Feb", ... under the Gregorian bars.</summary>
    public IReadOnlyList<string> GregorianMonthShortNames { get; }

    /// <summary>"Mos", ..., "Pau" (Saint Paul), ... under the 13-month bars.</summary>
    public IReadOnlyList<string> ThirteenMonthShortNames { get; }

    /// <summary>The Gregorian chart in words.</summary>
    public string GregorianChartAutomationName { get; }

    /// <summary>The 13-month chart in words.</summary>
    public string ThirteenChartAutomationName { get; }

    /// <summary>Gregorian Friday the 13ths.</summary>
    public StatFigure FridayGregorian { get; }

    /// <summary>13-month Friday the 13ths.</summary>
    public StatFigure FridayThirteen { get; }

    /// <summary>Quarter lengths, Gregorian then 13-month.</summary>
    public IReadOnlyList<QuarterRow> Quarters { get; }

    /// <summary>"Plus 1 day outside the 13-month quarters.", or null.</summary>
    public string? QuartersNote { get; }

    /// <summary>Whether <see cref="QuartersNote"/> is shown.</summary>
    public bool HasQuartersNote => QuartersNote is not null;

    /// <summary>Distinct Gregorian month shapes.</summary>
    public StatFigure ShapesGregorian { get; }

    /// <summary>The one 13-month shape.</summary>
    public StatFigure ShapesThirteen { get; }

    /// <summary>The 12 Gregorian silhouettes.</summary>
    public IReadOnlyList<ShapeGlyph> Shapes { get; }

    /// <summary>"Every IFC month: four full weeks, starting Sunday."</summary>
    public string ShapesNote { get; }

    /// <summary>Seven years of New Year's weekdays.</summary>
    public IReadOnlyList<DriftYear> DriftYears { get; }

    /// <summary>"IFC", "POSIT".</summary>
    public string DriftSystemLabel { get; }

    /// <summary>The drift explanation.</summary>
    public string DriftSentence { get; }

    /// <summary>The drift strip in words.</summary>
    public string DriftAutomationName { get; }

    /// <summary>Gregorian, IFC and Positivist side by side.</summary>
    public IReadOnlyList<CalendarColumn> Columns { get; }
}
