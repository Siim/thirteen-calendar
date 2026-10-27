using System.ComponentModel;
using System.Globalization;
using Avalonia.Media;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// Calendar's Year mode (SPEC 5.2, docs/EVENTS.md §2.3): all 13 perfect 4 x 7 grids with the intercalary day(s) in
/// their true positions, an optional Gregorian overlay, Gregorian-month-start markers and today highlighted, plus up to
/// three event dots per day in the colors of the first three calendars with events that day (<c>yearEventMarks</c>)
/// while "Show events in Year view" is on. Clicking a day opens its comparison in the detail pane; clicking a month
/// title opens Month mode on that month. The year is the year of <see cref="CalendarViewModel.Date"/>.
/// </summary>
public sealed class YearViewModel : CalendarModeViewModel
{
    private YearContent? _content;
    private int _builtYear;
    private GregorianDate? _selection;
    private GregorianDate? _pendingReveal;

    /// <summary>Year mode of <paramref name="calendar"/>.</summary>
    public YearViewModel(CalendarViewModel calendar) : base(calendar, CalendarMode.Year)
    {
        PreviousYearCommand = new RelayCommand(() => Year--, () => Year > GregorianDate.MinYear);
        NextYearCommand = new RelayCommand(() => Year++, () => Year < GregorianDate.MaxYear);
        TodayCommand = new RelayCommand(() =>
        {
            Calendar.Mode = CalendarMode.Year;
            Calendar.ShowToday();
        });
        State.PropertyChanged += OnStateChanged;
    }

    /// <summary>Raised when the view should bring a day's month into view and focus the day.</summary>
    public event EventHandler<GregorianDate>? RevealRequested;

    /// <summary>The Gregorian year shown (1..9999): the year of the Calendar's day. Setting it keeps the month and day.</summary>
    public int Year
    {
        get => Calendar.Date.Year;
        set => Calendar.SetYear(value);
    }

    /// <summary>The months of the year shown (built on first use).</summary>
    public YearContent Content
    {
        get
        {
            if (_content is null || _builtYear != Year) Rebuild();
            return _content!;
        }
    }

    /// <summary>Whether the cells show Gregorian dates (app-wide, persisted).</summary>
    public bool ShowsGregorianOverlay
    {
        get => State.ShowsGregorianOverlay;
        set => State.ShowsGregorianOverlay = value;
    }

    /// <summary>"Gregorian dates" (the overlay toggle, now in Year mode's own row; the toolbar holds only the §2.1 controls).</summary>
    public string OverlayText => "Gregorian dates";

    /// <summary>The legend under the header.</summary>
    public string Legend => State.ShowsGregorianOverlay
        ? "Small numbers are Gregorian dates; a bar marks the first of a Gregorian month. Click a day to compare."
        : "A bar marks the first of a Gregorian month. Click a day to compare.";

    /// <summary>Previous year (kept for the year's own controls and tests; the toolbar's "‹" pages the same way).</summary>
    public RelayCommand PreviousYearCommand { get; }

    /// <summary>Next year.</summary>
    public RelayCommand NextYearCommand { get; }

    /// <summary>The current year, revealing today's month.</summary>
    public RelayCommand TodayCommand { get; }

    /// <summary>Shows today's month in the current year and focuses today.</summary>
    public void ShowToday()
    {
        Calendar.Date = State.Today;
        Reveal(State.Today);
    }

    /// <summary>Asks the view to bring <paramref name="date"/> into view (if it is in the year shown).</summary>
    public void Reveal(GregorianDate date)
    {
        if (date.Year != Year) return;
        _pendingReveal = date;
        RevealRequested?.Invoke(this, date);
    }

    /// <summary>The last reveal not yet carried out by a view (the view may not exist yet), cleared on read.</summary>
    public GregorianDate? TakePendingReveal()
    {
        var date = _pendingReveal;
        _pendingReveal = null;
        return date is { } d && d.Year == Year ? d : null;
    }

    /// <summary>Highlights the day open in the detail pane.</summary>
    public void UpdateSelection(GregorianDate? date)
    {
        _selection = date;
        _content?.Select(date);
    }

    /// <inheritdoc />
    internal override void DateChanged()
    {
        // Selecting a day keeps the year: only a new year rebuilds the 13 grids.
        if (_builtYear != Year || _content is null) Invalidate();
        PreviousYearCommand.NotifyCanExecuteChanged();
        NextYearCommand.NotifyCanExecuteChanged();
    }

    /// <inheritdoc />
    protected override void Rebuild()
    {
        var year = Year;
        if (_content is null || _builtYear != year || _content.System != State.System || _content.Today != State.Today)
        {
            _content = new YearContent(year, State.System, State.Today, State.ShowsGregorianOverlay, Select, OpenMonth);
            _builtYear = year;
            _content.Select(_selection);
            OnPropertyChanged(nameof(Content));
        }
        ApplyEvents();
        PreviousYearCommand.NotifyCanExecuteChanged();
        NextYearCommand.NotifyCanExecuteChanged();
    }

    private void Select(GregorianDate date)
    {
        Calendar.Date = date;
        Shell.ShowDetail(date);
    }

    private void OpenMonth(int month) => Calendar.ShowMonth(Year, month);

    /// <summary>The dots and the cells' "{n} events" value from the store (§2.3).</summary>
    private void ApplyEvents()
    {
        if (_content is null) return;
        if (!State.ShowsYearEvents || Events is not { IsLoaded: true } events)
        {
            _content.ApplyMarks(null, null);
            return;
        }
        var items = events.Items(new GregorianDate(_builtYear, 1, 1), new GregorianDate(_builtYear, 12, 31));
        var colors = new Dictionary<string, Color>(StringComparer.Ordinal);
        foreach (var item in items) colors.TryAdd(item.CalendarId, item.Color);
        var marks = YearMark.Marks(_builtYear, items.Select(i => i.Occurrence));
        _content.ApplyMarks(marks, id => colors.GetValueOrDefault(id, Colors.Gray));
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppState.ShowsGregorianOverlay):
                _content?.ShowOverlay(State.ShowsGregorianOverlay);
                OnPropertyChanged(nameof(ShowsGregorianOverlay));
                OnPropertyChanged(nameof(Legend));
                break;
            case nameof(AppState.ShowsYearEvents):
                Invalidate();
                break;
        }
    }
}

/// <summary>The 13 month cards of one year.</summary>
public sealed class YearContent
{
    /// <summary>Builds the year.</summary>
    public YearContent(int year, CalendarSystemId system, GregorianDate today, bool showsGregorian, Action<GregorianDate> select, Action<int>? openMonth = null)
    {
        var layout = new ThirteenYearLayout(year, system);
        var structure = "13 × 28 + " + string.Join(" + ", layout.Intercalary.Select(i => i.ShortName));
        Year = year;
        System = system;
        Today = today;
        Header = new YearHeaderModel(year, system, structure);
        Months = layout.Months
            .Select(m => new YearMonthCard(m, layout.Intercalary.Where(i => i.AfterMonth == m.Month).ToArray(), today, showsGregorian, select, openMonth))
            .ToArray();
    }

    /// <summary>The Gregorian year.</summary>
    public int Year { get; }

    /// <summary>The system it was built for.</summary>
    public CalendarSystemId System { get; }

    /// <summary>The today it was built with.</summary>
    public GregorianDate Today { get; }

    /// <summary>The year and its caption ("Gregorian 2026 · 365 days · 13 × 28 + YD").</summary>
    public YearHeaderModel Header { get; }

    /// <summary>The 13 months.</summary>
    public IReadOnlyList<YearMonthCard> Months { get; }

    /// <summary>Highlights one day (or none).</summary>
    public void Select(GregorianDate? date)
    {
        foreach (var month in Months) month.Select(date);
    }

    /// <summary>Shows or hides the Gregorian overlay.</summary>
    public void ShowOverlay(bool show)
    {
        foreach (var month in Months) month.ShowOverlay(show);
    }

    /// <summary>Applies the event marks of the year (null: no dots, and no row reserved for them).</summary>
    public void ApplyMarks(IReadOnlyList<YearMark>? marks, Func<string, Color>? colorOf)
    {
        var byDay = marks?.ToDictionary(m => m.Gregorian) ?? [];
        foreach (var month in Months)
        {
            foreach (var cell in month.Grid.Cells) Apply(cell);
            foreach (var badge in month.Intercalary) Apply(badge);
        }

        void Apply(IEventMarked target)
        {
            if (marks is null)
            {
                target.SetEvents(false, [], 0);
                return;
            }
            if (byDay.TryGetValue(target.Date, out var mark))
            {
                target.SetEvents(true, mark.CalendarIds.Select(colorOf!).ToArray(), mark.Count);
            }
            else
            {
                target.SetEvents(true, [], 0);
            }
        }
    }
}

/// <summary>One month of the Year screen: title, Gregorian span, the 4 x 7 grid and any intercalary day that follows it.</summary>
public sealed class YearMonthCard
{
    /// <summary>Builds the card.</summary>
    public YearMonthCard(
        ThirteenMonthLayout month, IReadOnlyList<IntercalaryOccurrence> intercalary, GregorianDate today, bool showsGregorian,
        Action<GregorianDate> select, Action<int>? openMonth = null)
    {
        Month = month.Month;
        Name = month.MonthInfo.Name;
        Number = month.Month.ToString(CultureInfo.InvariantCulture);
        ContainsToday = month.Days.Any(d => d.Gregorian == today);
        // VoiceOver reads "Current month" on the Apple apps' card (YearView.swift).
        NumberAutomationName = ContainsToday ? $"Month {Number} of 13, current month" : $"Month {Number} of 13";
        var span = $"Gregorian {month.Weeks[0][0].Gregorian.Format(FormatOptions.Short)} to {month.Weeks[3][6].Gregorian.Format(FormatOptions.Short)}";
        Span = month.System == CalendarSystemId.Positivist && month.MonthInfo.Meaning is { } meaning
            ? $"{DisplayText.WithoutDashes(meaning)} · {span}"
            : span;
        Grid = MonthGridModel.ForThirteen(month, today, null, showsGregorian, select, narrowHeaders: true);
        Intercalary = intercalary.Select(i => new IntercalaryBadgeModel(i, today, showsGregorian, compact: true, select)).ToArray();
        OpenMonthCommand = new RelayCommand(() => openMonth?.Invoke(Month), () => openMonth is not null);
    }

    /// <summary>Month number 1..13.</summary>
    public int Month { get; }

    /// <summary>"October".</summary>
    public string Name { get; }

    /// <summary>"11".</summary>
    public string Number { get; }

    /// <summary>"Month 11 of 13", with ", current month" on today's month.</summary>
    public string NumberAutomationName { get; }

    /// <summary>Today falls in this month.</summary>
    public bool ContainsToday { get; }

    /// <summary>"Gregorian Oct 8 to Nov 4" (Positivist months add their theme).</summary>
    public string Span { get; }

    /// <summary>The 4 x 7 grid.</summary>
    public MonthGridModel Grid { get; }

    /// <summary>Intercalary days after this month.</summary>
    public IReadOnlyList<IntercalaryBadgeModel> Intercalary { get; }

    /// <summary>Whether an intercalary day follows this month.</summary>
    public bool HasIntercalary => Intercalary.Count > 0;

    /// <summary>The month title: opens Month mode on this month (§2.3).</summary>
    public RelayCommand OpenMonthCommand { get; }

    /// <summary>Whether <paramref name="date"/> falls in this month or its intercalary days.</summary>
    public bool Contains(GregorianDate date) =>
        Grid.Cells.Any(c => c.Date == date) || Intercalary.Any(i => i.Date == date);

    internal void Select(GregorianDate? date)
    {
        Grid.Select(date);
        foreach (var badge in Intercalary) badge.IsSelected = date is { } d && badge.Date == d;
    }

    internal void ShowOverlay(bool show)
    {
        Grid.ShowSub(show);
        foreach (var badge in Intercalary) badge.ShowsGregorian = show;
    }
}
