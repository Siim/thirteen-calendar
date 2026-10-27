using System.ComponentModel;
using System.Globalization;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// Today (SPEC 5.1): today's 13-month date, its Gregorian equivalent, fixed vs real weekday, label drift,
/// 13-segment year progress, the countdown to Year Day, the current 13-month grid and, the other way
/// round, the current Gregorian month with its 13-month dates.
/// </summary>
public sealed class TodayViewModel : PageViewModel
{
    private TodayContent _content;

    /// <summary>Creates the page.</summary>
    public TodayViewModel(MainViewModel shell) : base(shell, AppSection.Today)
    {
        _content = Build();
        FullComparisonCommand = new RelayCommand(() => Shell.ShowDetail(State.Today));
        UpNext = new UpNextViewModel(shell);
        State.PropertyChanged += OnStateChanged;
    }

    /// <summary>The "Up next" card under the hero (docs/EVENTS.md §2.8; task W9).</summary>
    public UpNextViewModel UpNext { get; }

    /// <summary>Everything the page shows.</summary>
    public TodayContent Content
    {
        get => _content;
        private set => SetProperty(ref _content, value);
    }

    /// <summary>Opens the day-detail pane for today.</summary>
    public RelayCommand FullComparisonCommand { get; }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppState.System) or nameof(AppState.Today)) Content = Build();
    }

    private TodayContent Build() => new(State.Today, State.System, date => Shell.ShowDetail(date));
}

/// <summary>The content of the Today page for one day and system.</summary>
public sealed class TodayContent
{
    /// <summary>Builds the page for <paramref name="today"/>.</summary>
    public TodayContent(GregorianDate today, CalendarSystemId system, Action<GregorianDate> showDetail)
    {
        var inv = CultureInfo.InvariantCulture;
        var comparison = new Comparison(today, system);
        Comparison = comparison;
        Hero = DatePlateModel.Create(comparison);
        DayOfYearText = Phrasing.DayOfYear(comparison);
        ProgressText = $"{Phrasing.Percent(comparison.YearProgress)} of the year done";
        ProgressAutomationName = ComparisonDetailModel.YearProgressText(comparison);

        var days = today.DaysUntilYearDay(system);
        CountdownNumber = days.ToString(inv);
        CountdownText = Phrasing.Countdown(days, system);
        CountdownDescription = DisplayText.WithoutDashes(system.IntercalaryDayInfo(IntercalaryDayId.YearDay).Description);

        Weekday = new WeekdayShiftModel(comparison);
        DriftAmount = Phrasing.DriftAmount(comparison.LabelDrift);
        DriftSentence = Phrasing.LabelDrift(comparison, relativeToToday: true);

        switch (comparison.Thirteen)
        {
            case ThirteenMonthDate date:
            {
                var layout = new ThirteenMonthLayout(date.Year, date.Month, date.System);
                IsMonthDay = true;
                MonthTitle = $"{date.MonthInfo.Name} {date.DisplayYear.ToString(inv)}";
                MonthSubtitle = $"Gregorian {layout.Weeks[0][0].Gregorian.Format(FormatOptions.Short)} to {layout.Weeks[3][6].Gregorian.Format(FormatOptions.Short)}";
                MonthGrid = MonthGridModel.ForThirteen(layout, today, null, showsGregorian: true, showDetail);
                MonthFootnote = $"Every month starts on a {date.System.WeekStartsOn().Name()} and has exactly four weeks. Small numbers are the Gregorian dates; a bar marks where a Gregorian month begins.";
                break;
            }
            case ThirteenIntercalaryDate date:
            {
                var occurrence = IntercalaryOccurrence.InYear(date.Year, date.System).First(o => o.Id == date.Id);
                IsIntercalaryDay = true;
                MonthTitle = "Outside the grid";
                MonthSubtitle = "Today belongs to no month and no week.";
                Intercalary = new IntercalaryBadgeModel(occurrence, today, showsGregorian: true, compact: false, showDetail);
                break;
            }
        }

        var gregorian = new GregorianMonthLayout(today.Year, today.Month, system);
        var first = gregorian.Days.First();
        var last = gregorian.Days.Last();
        var shortNoYear = new FormatOptions(DateStyle.Short, IncludeYear: false);
        GregorianTitle = $"Gregorian {gregorian.MonthInfo.Name} {today.Year.ToString(inv)}";
        GregorianSubtitle = $"{system.ShortName()} {first.Thirteen.Format(shortNoYear)} to {last.Thirteen.Format(shortNoYear)}";
        GregorianGrid = MonthGridModel.ForGregorian(gregorian, today, null, showDetail);
        var article = system == CalendarSystemId.Ifc ? "an" : "a";
        GregorianFootnote = $"{gregorian.MonthInfo.Name} has {gregorian.Days.Count().ToString(inv)} days and starts on a {first.GregorianWeekday.Name()}, so it spans {gregorian.Weeks.Count.ToString(inv)} rows; next month has a different shape again. Small numbers are the {system.ShortName()} dates; a bar marks where {article} {system.ShortName()} month begins.";
    }

    /// <summary>Today's comparison (drives the year-progress bar).</summary>
    public Comparison Comparison { get; }

    /// <summary>The hero date plate.</summary>
    public DatePlateModel Hero { get; }

    /// <summary>"Day 292 of 365".</summary>
    public string DayOfYearText { get; }

    /// <summary>"79.7% of the year done".</summary>
    public string ProgressText { get; }

    /// <summary>The year-progress bar's screen-reader name.</summary>
    public string ProgressAutomationName { get; }

    /// <summary>"73".</summary>
    public string CountdownNumber { get; }

    /// <summary>"73 days until Year Day".</summary>
    public string CountdownText { get; }

    /// <summary>The year-day's description from the engine (without dashes).</summary>
    public string CountdownDescription { get; }

    /// <summary>Fixed vs real weekday.</summary>
    public WeekdayShiftModel Weekday { get; }

    /// <summary>"7 days behind".</summary>
    public string DriftAmount { get; }

    /// <summary>The label-drift sentence, relative to today.</summary>
    public string DriftSentence { get; }

    /// <summary>Today is a month date (the month card shows its grid).</summary>
    public bool IsMonthDay { get; }

    /// <summary>Today is an intercalary day (the month card shows its badge).</summary>
    public bool IsIntercalaryDay { get; }

    /// <summary>"October 2026", or "Outside the grid".</summary>
    public string MonthTitle { get; } = "";

    /// <summary>"Gregorian Oct 8 to Nov 4".</summary>
    public string MonthSubtitle { get; } = "";

    /// <summary>The current 13-month month, or null on an intercalary day.</summary>
    public MonthGridModel? MonthGrid { get; }

    /// <summary>The note under the 13-month grid.</summary>
    public string MonthFootnote { get; } = "";

    /// <summary>Today's intercalary day, or null.</summary>
    public IntercalaryBadgeModel? Intercalary { get; }

    /// <summary>"Gregorian October 2026".</summary>
    public string GregorianTitle { get; }

    /// <summary>"IFC Sep 25 to Oct 24".</summary>
    public string GregorianSubtitle { get; }

    /// <summary>The current Gregorian month with its 13-month dates.</summary>
    public MonthGridModel GregorianGrid { get; }

    /// <summary>The note under the Gregorian grid.</summary>
    public string GregorianFootnote { get; }
}
