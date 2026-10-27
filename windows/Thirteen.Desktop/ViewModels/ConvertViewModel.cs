using System.ComponentModel;
using System.Globalization;
using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>One entry of the 13-month "Month" menu: a month or an intercalary day.</summary>
/// <param name="Key">"month-11", "leap-day", "year-day".</param>
/// <param name="Label">"October", "Leap Day".</param>
public sealed record SlotOption(string Key, string Label)
{
    /// <inheritdoc />
    public override string ToString() => Label;
}

/// <summary>
/// Convert (SPEC 5.3): a two-way converter. Gregorian to 13-month with a date picker and a calendar, and
/// 13-month to Gregorian with a year, a slot (13 months including Sol plus the intercalary days, in order)
/// and a 4 x 7 day picker. Both directions edit the same day, so swapping keeps it. Below: the full
/// comparison, "read this label in the other calendar" lookups and notable days.
/// </summary>
public sealed class ConvertViewModel : PageViewModel
{
    private GregorianDate _convertDay;
    private ConvertDirection _direction = ConvertDirection.FromGregorian;
    private ConvertContent _content;
    private IReadOnlyList<SlotOption> _slots = [];
    private (int Year, CalendarSystemId System) _slotsKey = (-1, CalendarSystemId.Ifc);
    private DateTime _calendarDisplayDate;

    // Above zero while the view is being told about a new day or system. Controls echo values back while
    // they update (the Month box re-selects its old slot when it gets the new year's list, the year box
    // clamps to a new system's range before it gets the new year); those echoes must not move the day.
    private int _syncDepth;

    /// <summary>Creates the page on today.</summary>
    public ConvertViewModel(MainViewModel shell) : base(shell, AppSection.Convert)
    {
        _convertDay = State.Today;
        _calendarDisplayDate = _convertDay.ToDateTime();
        _content = Build();
        RebuildSlots();
        SwapCommand = new RelayCommand(() => Direction = Direction == ConvertDirection.FromGregorian ? ConvertDirection.FromThirteen : ConvertDirection.FromGregorian);
        TodayCommand = new RelayCommand(() => ConvertDay = State.Today, () => ConvertDay != State.Today);
        ShowInYearCommand = new RelayCommand(() => Shell.ShowInYear(ConvertDay));
        State.PropertyChanged += OnStateChanged;
    }

    /// <summary>The converter's day (both sides show this same day).</summary>
    public GregorianDate ConvertDay
    {
        get => _convertDay;
        set
        {
            if (!SetProperty(ref _convertDay, value)) return;
            _syncDepth++;
            try
            {
                var display = value.ToDateTime();
                if (display.Year != _calendarDisplayDate.Year || display.Month != _calendarDisplayDate.Month) CalendarDisplayDate = display;
                Refresh();
            }
            finally
            {
                _syncDepth--;
            }
        }
    }

    /// <summary>Which side is the input.</summary>
    public ConvertDirection Direction
    {
        get => _direction;
        set
        {
            if (!SetProperty(ref _direction, value)) return;
            OnPropertyChanged(nameof(IsFromGregorian));
            OnPropertyChanged(nameof(IsFromThirteen));
            Content = Build();
        }
    }

    /// <summary>Gregorian in (radio binding).</summary>
    public bool IsFromGregorian
    {
        get => _direction == ConvertDirection.FromGregorian;
        set
        {
            if (value) Direction = ConvertDirection.FromGregorian;
        }
    }

    /// <summary>13-month in (radio binding).</summary>
    public bool IsFromThirteen
    {
        get => _direction == ConvertDirection.FromThirteen;
        set
        {
            if (value) Direction = ConvertDirection.FromThirteen;
        }
    }

    /// <summary>"Gregorian → IFC".</summary>
    public string FromGregorianLabel => $"Gregorian → {State.System.ShortName()}";

    /// <summary>"IFC → Gregorian".</summary>
    public string FromThirteenLabel => $"{State.System.ShortName()} → Gregorian";

    /// <summary>Everything that depends on the day.</summary>
    public ConvertContent Content
    {
        get => _content;
        private set => SetProperty(ref _content, value);
    }

    // ---- Gregorian input ----------------------------------------------------------------------

    /// <summary>The day as a <see cref="DateTime"/> for the date picker and calendar (every year 1..9999 works).</summary>
    public DateTime? SelectedDateTime
    {
        get => _convertDay.ToDateTime();
        set
        {
            if (value is { } picked && _syncDepth == 0) ConvertDay = GregorianDate.FromDateTime(picked);
        }
    }

    /// <summary>The month the calendar shows.</summary>
    public DateTime CalendarDisplayDate
    {
        get => _calendarDisplayDate;
        set => SetProperty(ref _calendarDisplayDate, value);
    }

    /// <summary>The calendar's first column: the system's week start, so it lines up with the 13-month grids.</summary>
    public DayOfWeek FirstDayOfWeek => State.System.WeekStartsOn().ToDayOfWeek();

    // ---- 13-month input -----------------------------------------------------------------------

    /// <summary>The system's year number for the year box.</summary>
    public decimal? DisplayYear
    {
        get => _convertDay.ToThirteen(State.System).DisplayYear;
        set
        {
            if (_syncDepth > 0) return;
            var range = State.System.DisplayYearRange();
            // An empty or impossible year leaves the day alone (the view puts the day's year back in the box).
            if (value is not { } year || year != Math.Round(year) || year < range.Min || year > range.Max) return;
            ConvertDay = new ThirteenPickerLogic(State.System, _convertDay).SettingDisplayYear((int)year);
        }
    }

    /// <summary>Lowest display year.</summary>
    public decimal YearMinimum => State.System.DisplayYearRange().Min;

    /// <summary>Highest display year.</summary>
    public decimal YearMaximum => State.System.DisplayYearRange().Max;

    /// <summary>The months and intercalary days of the year, in order.</summary>
    public IReadOnlyList<SlotOption> Slots
    {
        get => _slots;
        private set => SetProperty(ref _slots, value);
    }

    /// <summary>The slot holding the day.</summary>
    public SlotOption? SelectedSlot
    {
        get
        {
            var key = new ThirteenPickerLogic(State.System, _convertDay).SlotKey;
            return _slots.FirstOrDefault(s => s.Key == key);
        }
        set
        {
            if (value is null || _syncDepth > 0) return;
            ConvertDay = new ThirteenPickerLogic(State.System, _convertDay).SettingSlot(value.Key);
        }
    }

    /// <summary>Swaps input and result.</summary>
    public RelayCommand SwapCommand { get; }

    /// <summary>Back to today.</summary>
    public RelayCommand TodayCommand { get; }

    /// <summary>Opens the day in Year with its comparison.</summary>
    public RelayCommand ShowInYearCommand { get; }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppState.System))
        {
            OnPropertyChanged(nameof(FromGregorianLabel));
            OnPropertyChanged(nameof(FromThirteenLabel));
            OnPropertyChanged(nameof(FirstDayOfWeek));
            _syncDepth++;
            try
            {
                Refresh();
            }
            finally
            {
                _syncDepth--;
            }
        }
        else if (e.PropertyName is nameof(AppState.Today))
        {
            Content = Build();
            TodayCommand.NotifyCanExecuteChanged();
        }
    }

    private void Refresh()
    {
        RebuildSlots();
        Content = Build();
        OnPropertyChanged(nameof(SelectedDateTime));
        // The range before the year: the box may clamp its old year to the new range on the way (an echo,
        // ignored), but never clamps the new year to the old range.
        OnPropertyChanged(nameof(YearMinimum));
        OnPropertyChanged(nameof(YearMaximum));
        OnPropertyChanged(nameof(DisplayYear));
        OnPropertyChanged(nameof(SelectedSlot));
        TodayCommand?.NotifyCanExecuteChanged();
    }

    private void RebuildSlots()
    {
        var key = (_convertDay.Year, State.System);
        if (key == _slotsKey) return;
        _slotsKey = key;
        Slots = ThirteenSlot.InYear(_convertDay.Year, State.System).Select(s => new SlotOption(s.Key, ThirteenPickerLogic.Label(s))).ToArray();
    }

    private ConvertContent Build() => new(_convertDay, State.Today, State.System, _direction, d => ConvertDay = d);
}

/// <summary>A "same label, other calendar" row.</summary>
/// <param name="Heading">"“October 19” in IFC".</param>
/// <param name="Text">The explanation.</param>
/// <param name="GoText">"Go to Gregorian Oct 12, 2026", or null when there is nowhere to go.</param>
/// <param name="GoCommand">Moves the converter there.</param>
public sealed record LookupRow(string Heading, string Text, string? GoText, ICommand? GoCommand)
{
    /// <summary>Whether the "Go to" button is shown.</summary>
    public bool HasGo => GoText is not null;
}

/// <summary>A notable-day quick pick.</summary>
public sealed record NotablePick(string Name, string GregorianText, string ThirteenText, bool IsSelected, string AutomationName, ICommand Command);

/// <summary>Everything the converter shows for one day.</summary>
public sealed class ConvertContent
{
    /// <summary>Builds the converter for <paramref name="day"/>.</summary>
    public ConvertContent(GregorianDate day, GregorianDate today, CalendarSystemId system, ConvertDirection direction, Action<GregorianDate> go)
    {
        var inv = CultureInfo.InvariantCulture;
        var comparison = new Comparison(day, system);
        var shortName = system.ShortName();
        IsFromGregorian = direction == ConvertDirection.FromGregorian;
        InputTitle = IsFromGregorian ? "Gregorian date" : $"{shortName} date";
        IsoText = day.ToIsoString();
        IsoAutomationName = $"ISO date {IsoText}";
        YearNote = Phrasing.GregorianYearNote(day.Year, system);

        var thirteen = comparison.Thirteen;
        switch (thirteen)
        {
            case ThirteenMonthDate date:
                DayGrid = MonthGridModel.ForThirteen(new ThirteenMonthLayout(date.Year, date.Month, system), today, day, showsGregorian: true, go);
                break;
            case ThirteenIntercalaryDate date:
                var occurrence = IntercalaryOccurrence.InYear(date.Year, system).First(o => o.Id == date.Id);
                Badge = new IntercalaryBadgeModel(occurrence, today, showsGregorian: true, compact: false, select: null) { IsSelected = true };
                break;
        }

        Plate = DatePlateModel.Create(comparison, gregorianPrimary: !IsFromGregorian);
        Detail = new ComparisonDetailModel(comparison, relativeToToday: day == today);

        // Same label, other calendar.
        var gregorianLookup = new GregorianLabelLookup(day, system);
        var thirteenLookup = new ThirteenLabelLookup(thirteen);
        var noYear = new FormatOptions(DateStyle.Long, IncludeYear: false);
        var mediumWeekday = new FormatOptions(DateStyle.Medium, IncludeWeekday: true);
        var gregorianLabel = day.Format(noYear);
        var thirteenLabel = thirteenLookup.Thirteen.Format(noYear);
        var noLabel = system == CalendarSystemId.Positivist
            ? "No Positivist month carries a Gregorian name."
            : $"{shortName} months have 28 days, so there is no {shortName} “{gregorianLabel}”.";
        Lookups =
        [
            Row(
                $"“{gregorianLabel}” in {shortName}",
                gregorianLookup.SameLabel is { } same
                    ? $"{shortName} {same.Format(noYear)} falls on Gregorian {gregorianLookup.SameLabelFallsOn?.Format(mediumWeekday)}."
                    : noLabel,
                gregorianLookup.SameLabelFallsOn),
            Row(
                $"“{thirteenLabel}” in Gregorian",
                thirteenLookup.SameLabel is { } label
                    ? $"Gregorian {label.Format(noYear)} is {shortName} {thirteenLookup.SameLabelFallsOn?.Format(mediumWeekday)}."
                    : $"No Gregorian month is called {thirteenLookup.Thirteen.MonthDate?.MonthInfo.Name ?? thirteenLabel}, so this label has no Gregorian reading.",
                thirteenLookup.SameLabel),
        ];

        LookupRow Row(string heading, string text, GregorianDate? target) =>
            target is { } t && t != day
                ? new LookupRow(heading, text, $"Go to Gregorian {t.Format(FormatOptions.Medium)}", new RelayCommand(() => go(t)))
                : new LookupRow(heading, text, null, null);

        // Notable days.
        NotablesTitle = $"Notable days in {day.Year.ToString(inv)}";
        Notables = NotableDateInYear.InYear(day.Year, system).Select(n => new NotablePick(
            n.Notable.Name,
            $"Gregorian {n.Gregorian.Format(FormatOptions.Short)}",
            $"{shortName} {n.Thirteen.Format(FormatOptions.Short)}",
            n.Gregorian == day,
            $"{n.Notable.Name}: Gregorian {n.Gregorian.Format(FormatOptions.Long)}, {shortName} {n.Thirteen.Format(FormatOptions.Long)}",
            new RelayCommand(() => go(n.Gregorian)))).ToArray();
    }

    /// <summary>The input is the Gregorian side.</summary>
    public bool IsFromGregorian { get; }

    /// <summary>The input is the 13-month side.</summary>
    public bool IsFromThirteen => !IsFromGregorian;

    /// <summary>"Gregorian date" or "IFC date".</summary>
    public string InputTitle { get; }

    /// <summary>"2026-10-19".</summary>
    public string IsoText { get; }

    /// <summary>"ISO date 2026-10-19".</summary>
    public string IsoAutomationName { get; }

    /// <summary>"Gregorian 2026" beside a Positivist year.</summary>
    public string? YearNote { get; }

    /// <summary>Whether <see cref="YearNote"/> is shown.</summary>
    public bool HasYearNote => YearNote is not null;

    /// <summary>The day picker (the day's 13-month month), or null on an intercalary day.</summary>
    public MonthGridModel? DayGrid { get; }

    /// <summary>The intercalary day, or null.</summary>
    public IntercalaryBadgeModel? Badge { get; }

    /// <summary>The result plate.</summary>
    public DatePlateModel Plate { get; }

    /// <summary>The full comparison.</summary>
    public ComparisonDetailModel Detail { get; }

    /// <summary>The two lookups.</summary>
    public IReadOnlyList<LookupRow> Lookups { get; }

    /// <summary>"Notable days in 2026".</summary>
    public string NotablesTitle { get; }

    /// <summary>The quick picks.</summary>
    public IReadOnlyList<NotablePick> Notables { get; }
}
