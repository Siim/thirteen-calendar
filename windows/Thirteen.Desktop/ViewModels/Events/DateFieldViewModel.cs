using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>
/// The 13-month date field (docs/EVENTS.md §2.12) of the editor's Starts, Ends and End repeat rows: the closed state
/// shows <c>IFC Thu, Oct 12, 2026</c> (typing <c>2026-M10-12</c>, <c>2026-YD</c> or <c>2026-10-19</c> into it parses
/// it), the Gregorian caption under the row, and the picker it opens. In the editor the range is 1583 to 9999 (§3.1.1):
/// typed dates outside it are refused with <c>editor.error.outOfRange</c>.
/// </summary>
public sealed class DateFieldViewModel : ViewModelBase
{
    /// <summary>The earliest date the editor accepts (§3.1.1).</summary>
    public static readonly GregorianDate EarliestEditable = new(1583, 1, 1);

    private GregorianDate _date;
    private string _text = "";
    private string? _error;
    private readonly Func<GregorianDate> _today;

    /// <summary>A field named <paramref name="label"/> ("Starts", "Ends", "End repeat") on <paramref name="date"/>.</summary>
    public DateFieldViewModel(string label, CalendarSystemId system, GregorianDate date, Func<GregorianDate> today, bool limitRange = true)
    {
        Label = label;
        System = system;
        _date = date;
        _today = today ?? throw new ArgumentNullException(nameof(today));
        LimitRange = limitRange;
        _text = EditorStrings.DateButton(date, system);
        OpenPickerCommand = new RelayCommand(() => PickerRequested?.Invoke(this, CreatePicker()));
    }

    /// <summary>The row's label (<c>editor.starts</c>, <c>editor.ends</c>, <c>editor.endRepeat</c>).</summary>
    public string Label { get; }

    /// <summary>The 13-month system the field shows.</summary>
    public CalendarSystemId System { get; }

    /// <summary>Years 1583 to 9999 only (the editor; the Converter keeps 1 to 9999).</summary>
    public bool LimitRange { get; }

    /// <summary>
    /// The Starts field while the draft repeats on its leap-only day (§2.11, §2.12): the year stepper moves between leap
    /// years only, with <c>picker.leapRepeat</c>.
    /// </summary>
    public bool StepsLeapYears { get; set; }

    /// <summary>Days the picker disables (a day a time zone skips, SPEC §1.5), or null.</summary>
    public Func<GregorianDate, bool>? IsSkipped { get; set; }

    /// <summary>The date (set by the editor; the user's changes raise <see cref="Changed"/>).</summary>
    public GregorianDate Date
    {
        get => _date;
        set
        {
            if (_date == value && _text == EditorStrings.DateButton(value, System)) return;
            _date = value;
            _text = EditorStrings.DateButton(value, System);
            OnPropertyChanged();
            OnPropertyChanged(nameof(Text));
            OnPropertyChanged(nameof(Caption));
            OnPropertyChanged(nameof(AccessibleName));
        }
    }

    /// <summary>The closed state's text (<c>editor.dateButton</c>), or what the user is typing.</summary>
    public string Text
    {
        get => _text;
        set => SetProperty(ref _text, value ?? "");
    }

    /// <summary><c>editor.gregorianCaption</c>: "Gregorian Monday, October 19, 2026".</summary>
    public string Caption => EditorStrings.GregorianCaption(_date);

    /// <summary><c>editor.dateButton.a11y</c>: "Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026".</summary>
    public string AccessibleName => EditorStrings.DateButtonA11y(Label, _date, System);

    /// <summary>A refused typed date (<c>editor.error.outOfRange</c>), or null.</summary>
    public string? Error
    {
        get => _error;
        set
        {
            if (SetProperty(ref _error, value)) OnPropertyChanged(nameof(HasError));
        }
    }

    /// <summary>Whether <see cref="Error"/> is shown.</summary>
    public bool HasError => _error is not null;

    /// <summary>Raised with a new date the user chose (typed or picked).</summary>
    public event Action<GregorianDate>? Changed;

    /// <summary>Raised with a new picker when the field's button (or Alt+Down, F4) asks for it.</summary>
    public event EventHandler<ThirteenDatePickerViewModel>? PickerRequested;

    /// <summary>Opens the picker.</summary>
    public RelayCommand OpenPickerCommand { get; }

    /// <summary>
    /// The text the user typed, committed (Enter, or leaving the field): a numeric 13-month date (<c>2026-M10-12</c>,
    /// <c>2026-YD</c>, Positivist <c>0238-M11-12</c>), an ISO date (<c>2026-10-19</c>) or the shown form. Unreadable
    /// text goes back to the date; a date outside the range is refused with <c>editor.error.outOfRange</c>.
    /// </summary>
    public bool CommitText()
    {
        var text = _text.Trim();
        if (text == EditorStrings.DateButton(_date, System))
        {
            Error = null;
            return false;
        }
        GregorianDate? parsed = null;
        if (ThirteenDate.TryParseNumeric(text, System, out var thirteen)) parsed = thirteen.Gregorian;
        else if (GregorianDate.TryParseIso(text, out var iso)) parsed = iso;
        if (parsed is not { } date)
        {
            Text = EditorStrings.DateButton(_date, System);
            return false;
        }
        if (!InRange(date))
        {
            Error = EditorStrings.ErrorOutOfRange;
            Text = EditorStrings.DateButton(_date, System);
            return false;
        }
        Error = null;
        Choose(date);
        return true;
    }

    /// <summary>Whether a date is in the field's range.</summary>
    public bool InRange(GregorianDate date) => !LimitRange || date >= EarliestEditable;

    /// <summary>Sets the date as the user's choice and raises <see cref="Changed"/>.</summary>
    public void Choose(GregorianDate date)
    {
        if (!InRange(date)) return;
        Error = null;
        var changed = date != _date;
        Date = date;
        if (changed) Changed?.Invoke(date);
    }

    /// <summary>A picker on the field's date.</summary>
    public ThirteenDatePickerViewModel CreatePicker() => new(this, _today());
}

/// <summary>The two tabs of the picker (§2.12).</summary>
public enum PickerTab
{
    /// <summary>The 13-month tab ("IFC").</summary>
    Thirteen,

    /// <summary>The Gregorian tab.</summary>
    Gregorian,
}

/// <summary>A slot of the picker's strip (§2.12): a month or an intercalary day.</summary>
/// <param name="Key">"month-11", "year-day".</param>
/// <param name="Short">The strip's text: "Oct", "LD", "YD".</param>
/// <param name="Name">Its accessible name: "October, month 11 of 13", "Leap Day, leap years only".</param>
/// <param name="IsIntercalary">An intercalary day.</param>
/// <param name="IsEnabled">In range.</param>
public sealed record PickerSlot(string Key, string Short, string Name, bool IsIntercalary, bool IsEnabled);

/// <summary>A day of the picker's 4 x 7 grid (or list at 150 % text).</summary>
public sealed class PickerDay : ViewModelBase
{
    private bool _isSelected;

    internal PickerDay(GregorianDate date, CalendarSystemId system, bool isToday, bool isEnabled)
    {
        Date = date;
        var thirteen = (ThirteenMonthDate)date.ToThirteen(system);
        Day = thirteen.Day.ToString(global::System.Globalization.CultureInfo.InvariantCulture);
        GregorianDay = date.Day == 1 ? date.Format(new FormatOptions(DateStyle.Short, IncludeYear: false)) : date.Day.ToString(global::System.Globalization.CultureInfo.InvariantCulture);
        Name = EditorStrings.Cell(CalendarStrings.ThirteenDayHeading(thirteen), CalendarStrings.GregorianLongNoYear(date));
        Heading = CalendarStrings.ThirteenDayHeading(thirteen);
        GregorianLine = CalendarStrings.GregorianDayCaption(date);
        IsToday = isToday;
        IsEnabled = isEnabled;
    }

    /// <summary>The day.</summary>
    public GregorianDate Date { get; }

    /// <summary>The 13-month day of the month: "12".</summary>
    public string Day { get; }

    /// <summary>The Gregorian day under it: "19", or "Nov 1" where a Gregorian month begins.</summary>
    public string GregorianDay { get; }

    /// <summary><c>picker.cell</c>: "Thursday, October 12. Gregorian Monday, October 19".</summary>
    public string Name { get; }

    /// <summary>The list row's first line at 150 % text: "Thursday, October 12".</summary>
    public string Heading { get; }

    /// <summary>The list row's second line: "Gregorian Mon, Oct 19".</summary>
    public string GregorianLine { get; }

    /// <summary>Today ("Today" as the cell's item status).</summary>
    public bool IsToday { get; }

    /// <summary>"Today" for today's cell, else null (UI Automation ItemStatus).</summary>
    public string? Status => IsToday ? EditorStrings.Today : null;

    /// <summary>In range and not skipped by the zone.</summary>
    public bool IsEnabled { get; }

    /// <summary>The selected day.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>A column of the picker's two-line weekday header (§2.4): the 13-month weekday over the Gregorian one.</summary>
/// <param name="Thirteen">"S".</param>
/// <param name="Gregorian">"T".</param>
/// <param name="Name"><c>calendar.weekday.a11y</c>: "Sunday. Gregorian Thursday".</param>
public sealed record PickerColumn(string Thirteen, string Gregorian, string Name);

/// <summary>
/// The open 13-month date picker (§2.12): the IFC and Gregorian tabs, the year stepper (with the leap-only fallback and
/// the leap-repeat stepping), the slot strip, the month grid (a list at 150 % text), an intercalary day's badge, the
/// announced caption, the other calendar's footer and the keyboard of §2.12. The chosen date goes to its field on Done
/// or Enter.
/// </summary>
public sealed class ThirteenDatePickerViewModel : ViewModelBase
{
    private readonly DateFieldViewModel _field;
    private readonly GregorianDate _today;
    private GregorianDate _date;
    private PickerTab _tab;
    private string? _caption;
    private IReadOnlyList<PickerSlot> _slots = [];
    private PickerSlot? _selectedSlot;
    private IReadOnlyList<PickerDay> _days = [];
    private IReadOnlyList<PickerColumn> _columns = [];
    private bool _rebuilding;

    /// <summary>Whether a picker starts on the Gregorian tab (the tab last used on this device, §2.12); set from the settings.</summary>
    public static PickerTab LastTab { get; set; } = PickerTab.Thirteen;

    /// <summary>Raised when the tab changes (the window stores it with the per-device view settings).</summary>
    public static event Action<PickerTab>? TabChosen;

    internal ThirteenDatePickerViewModel(DateFieldViewModel field, GregorianDate today)
    {
        _field = field;
        _today = today;
        _date = field.Date;
        _tab = LastTab;
        DoneCommand = new RelayCommand(Done);
        PreviousYearCommand = new RelayCommand(() => StepYear(-1), () => CanStepYear(-1));
        NextYearCommand = new RelayCommand(() => StepYear(1), () => CanStepYear(1));
        Rebuild();
    }

    /// <summary>The field the picker belongs to.</summary>
    public DateFieldViewModel Field => _field;

    /// <summary>The 13-month system.</summary>
    public CalendarSystemId System => _field.System;

    /// <summary>The 13-month tab's title: the system's short name ("IFC").</summary>
    public string ThirteenTabTitle => System.ShortName();

    /// <summary><c>picker.tab.gregorian</c></summary>
    public string GregorianTabTitle => EditorStrings.TabGregorian;

    /// <summary><c>picker.done</c></summary>
    public string DoneText => EditorStrings.Done;

    /// <summary><c>picker.year</c> (the stepper's accessible name).</summary>
    public string YearLabel => EditorStrings.Year;

    /// <summary>The previous-year button's name ("Previous year", as on the other platforms).</summary>
    public string PreviousYearLabel => EditorStrings.PreviousYear;

    /// <summary>The next-year button's name ("Next year").</summary>
    public string NextYearLabel => EditorStrings.NextYear;

    /// <summary>The year shown as a number (the stepper's RangeValue value: 2026, or 238 in the Positivist calendar).</summary>
    public int YearValue => _date.ToThirteen(System).DisplayYear;

    /// <summary>The first year the stepper reaches, as a display year.</summary>
    public int MinimumYearValue => System.DisplayYear(MinYear);

    /// <summary>The last year the stepper reaches, as a display year.</summary>
    public int MaximumYearValue => System.DisplayYear(9999);

    /// <summary>Sets the year through UI Automation (RangeValue SetValue): steps until the display year is reached.</summary>
    public void SetYearValue(int displayYear)
    {
        for (var guard = 0; guard < 10000 && YearValue != displayYear; guard++)
        {
            var direction = displayYear > YearValue ? 1 : -1;
            if (!CanStepYear(direction)) break;
            var before = YearValue;
            StepYear(direction);
            // A leap-only day steps to the next leap year: stop once the wanted year is passed.
            if ((direction > 0 && YearValue > displayYear) || (direction < 0 && YearValue < displayYear) || YearValue == before) break;
        }
    }

    /// <summary>The selected date (not yet the field's until Done).</summary>
    public GregorianDate Date
    {
        get => _date;
        private set
        {
            if (_date == value) return;
            _date = value;
            OnPropertyChanged();
            Rebuild();
        }
    }

    /// <summary>The selected date as a <see cref="DateTime"/> for the Gregorian tab's calendar control.</summary>
    public DateTime? GregorianSelection
    {
        get => new DateTime(_date.Year, _date.Month, _date.Day);
        set
        {
            if (value is not { } d) return;
            var date = new GregorianDate(d.Year, d.Month, d.Day);
            if (!_field.InRange(date)) return;
            _caption = null;
            Date = date;
        }
    }

    /// <summary>The first day the Gregorian tab allows.</summary>
    public DateTime GregorianStart => _field.LimitRange ? new DateTime(1583, 1, 1) : new DateTime(1, 1, 1);

    /// <summary>The tab shown.</summary>
    public PickerTab Tab
    {
        get => _tab;
        set
        {
            if (!SetProperty(ref _tab, value)) return;
            OnPropertyChanged(nameof(IsThirteenTab));
            OnPropertyChanged(nameof(IsGregorianTab));
            OnPropertyChanged(nameof(Footer));
            LastTab = value;
            TabChosen?.Invoke(value);
        }
    }

    /// <summary>The 13-month tab is shown.</summary>
    public bool IsThirteenTab
    {
        get => _tab == PickerTab.Thirteen;
        set
        {
            if (value) Tab = PickerTab.Thirteen;
        }
    }

    /// <summary>The Gregorian tab is shown.</summary>
    public bool IsGregorianTab
    {
        get => _tab == PickerTab.Gregorian;
        set
        {
            if (value) Tab = PickerTab.Gregorian;
        }
    }

    /// <summary>The year stepper's text: "2026" (Positivist "238").</summary>
    public string YearText => _date.ToThirteen(System).DisplayYear.ToString(global::System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The year stepper's value text: "2026", Positivist "238, Gregorian 2026".</summary>
    public string YearValueText => EditorStrings.YearValue(_date.ToThirteen(System).DisplayYear, _date.Year, System);

    /// <summary>The slots of the year in picker order (<c>thirteenSlots</c>; LD only in leap years).</summary>
    public IReadOnlyList<PickerSlot> Slots
    {
        get => _slots;
        private set => SetProperty(ref _slots, value);
    }

    /// <summary>The slot holding the date. Choosing another moves the date there (an intercalary slot selects that day).</summary>
    public PickerSlot? SelectedSlot
    {
        get => _selectedSlot;
        set
        {
            if (_rebuilding || value is null || value == _selectedSlot) return;
            if (!value.IsEnabled)
            {
                OnPropertyChanged();
                return;
            }
            _caption = null;
            var target = new ThirteenPickerLogic(System, _date).SettingSlot(value.Key);
            if (_field.InRange(target)) Date = target;
            else OnPropertyChanged();
        }
    }

    /// <summary>The weekday header: 7 columns.</summary>
    public IReadOnlyList<PickerColumn> Columns
    {
        get => _columns;
        private set => SetProperty(ref _columns, value);
    }

    /// <summary>The month's 28 days (empty on an intercalary slot).</summary>
    public IReadOnlyList<PickerDay> Days
    {
        get => _days;
        private set => SetProperty(ref _days, value);
    }

    /// <summary>The selected day's cell (the grid's selection).</summary>
    public PickerDay? SelectedDay
    {
        get => _days.FirstOrDefault(d => d.IsSelected);
        set
        {
            if (_rebuilding || value is null || !value.IsEnabled || value.Date == _date) return;
            _caption = null;
            Date = value.Date;
        }
    }

    /// <summary>An intercalary day is selected: its badge replaces the grid.</summary>
    public bool IsIntercalary => _date.ToThirteen(System) is ThirteenIntercalaryDate;

    /// <summary>The month grid is shown.</summary>
    public bool ShowsGrid => !IsIntercalary;

    /// <summary>The badge's code: "LD", "YD".</summary>
    public string BadgeCode => (_date.ToThirteen(System) as ThirteenIntercalaryDate)?.Info.Code ?? "";

    /// <summary>The badge's title: "Leap Day 2028".</summary>
    public string BadgeTitle => _date.ToThirteen(System) is ThirteenIntercalaryDate i ? i.Format(FormatOptions.Long) : "";

    /// <summary>The badge's line: "No weekday" (and "Leap Day happens only in leap years." for leap-only days).</summary>
    public string BadgeDetail => _date.ToThirteen(System) is ThirteenIntercalaryDate i
        ? i.Info.LeapOnly ? $"{EditorStrings.NoWeekday}. {EditorStrings.LeapOnly(i.Info.Name)}" : EditorStrings.NoWeekday
        : "";

    /// <summary>The announced caption under the grid (<c>picker.fellBack</c>, <c>picker.leapRepeat</c>), or null.</summary>
    public string? Caption
    {
        get => _caption;
        private set
        {
            _caption = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasCaption));
        }
    }

    /// <summary>Whether a caption is shown.</summary>
    public bool HasCaption => _caption is not null;

    /// <summary>The footer: the other calendar's date ("Gregorian Monday, October 19, 2026" or "IFC Thursday, October 12, 2026").</summary>
    public string Footer => _tab == PickerTab.Thirteen ? EditorStrings.GregorianCaption(_date) : EditorStrings.ThirteenCaption(_date, System);

    /// <summary>Done (and Enter): the date goes to the field.</summary>
    public RelayCommand DoneCommand { get; }

    /// <summary>The year stepper's previous.</summary>
    public RelayCommand PreviousYearCommand { get; }

    /// <summary>The year stepper's next.</summary>
    public RelayCommand NextYearCommand { get; }

    /// <summary>Raised when the picker should close (Done, Enter, Escape).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Done: the selected date goes to the field, and the picker closes.</summary>
    public void Done()
    {
        _field.Choose(_date);
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Escape: closes without changing the field.</summary>
    public void Cancel() => CloseRequested?.Invoke(this, EventArgs.Empty);

    // ---- Year stepping (§2.12) ---------------------------------------------------------------------------

    private int MinYear => _field.LimitRange ? 1583 : 1;

    private bool LeapRepeating => _field.StepsLeapYears && _date.ToThirteen(System) is ThirteenIntercalaryDate { Info.LeapOnly: true };

    private int? TargetYear(int direction)
    {
        var year = _date.Year + direction;
        if (LeapRepeating)
        {
            while (year >= MinYear && year <= 9999 && !GregorianDate.IsLeapYear(year)) year += direction;
        }
        return year >= MinYear && year <= 9999 ? year : null;
    }

    /// <summary>Whether the stepper can move by <paramref name="direction"/> years.</summary>
    public bool CanStepYear(int direction) => TargetYear(direction) is not null;

    /// <summary>
    /// Moves the year (Shift+Page Up / Page Down, the stepper): the same slot in the other year; a leap-only day that the
    /// year lacks falls back to the day before it with <c>picker.fellBack</c>, unless the Starts field repeats on it, when
    /// the year moves to the previous or next leap year with <c>picker.leapRepeat</c>.
    /// </summary>
    public void StepYear(int direction)
    {
        if (TargetYear(direction) is not { } year) return;
        var thirteen = _date.ToThirteen(System);
        var leapRepeating = LeapRepeating;
        var target = new ThirteenPickerLogic(System, _date).SettingDisplayYear(System.DisplayYear(year));
        string? caption = null;
        if (thirteen is ThirteenIntercalaryDate { Info.LeapOnly: true } leapDay)
        {
            if (leapRepeating)
            {
                caption = Math.Abs(year - _date.Year) > 1 ? EditorStrings.LeapRepeat(leapDay.Info.Name, System.DisplayYear(year)) : null;
            }
            else if (target.ToThirteen(System) is not ThirteenIntercalaryDate { Info.LeapOnly: true })
            {
                caption = EditorStrings.FellBack(System.DisplayYear(year), leapDay.Info.Name, FellBackName(target));
            }
        }
        Date = target;
        Caption = caption;
    }

    /// <summary>"June 28" (the day a missing leap-only day falls back to); Positivist "the Festival of All the Dead".</summary>
    private string FellBackName(GregorianDate date) => date.ToThirteen(System) switch
    {
        ThirteenMonthDate m => $"{m.MonthInfo.Name} {m.Day.ToString(global::System.Globalization.CultureInfo.InvariantCulture)}",
        ThirteenIntercalaryDate i => "the " + i.Info.Name,
        _ => date.ToIsoString(),
    };

    // ---- Keyboard (§2.12) ----------------------------------------------------------------------------------

    /// <summary>Left and Right: one day in reading order, through intercalary days.</summary>
    public void MoveDays(int days) => Go(SafeAdd(_date, days));

    /// <summary>Up and Down: the same column one row up or down, into the previous or next month; from an intercalary day, the day before or after it.</summary>
    public void MoveRows(int rows)
    {
        if (_date.ToThirteen(System) is not ThirteenMonthDate m)
        {
            MoveDays(Math.Sign(rows));
            return;
        }
        var day = m.Day + rows * 7;
        ThirteenMonthDate target;
        try
        {
            if (day < 1)
            {
                var previous = m.AddMonths(-1);
                target = new ThirteenMonthDate(previous.Year, previous.Month, day + 28, System);
            }
            else if (day > 28)
            {
                var next = m.AddMonths(1);
                target = new ThirteenMonthDate(next.Year, next.Month, day - 28, System);
            }
            else
            {
                target = new ThirteenMonthDate(m.Year, m.Month, day, System);
            }
        }
        catch (ArgumentException)
        {
            return;
        }
        Go(target.Gregorian);
    }

    /// <summary>Page Up and Page Down: one 13-month month (from an intercalary day, the month next to it).</summary>
    public void MoveMonths(int months)
    {
        var thirteen = _date.ToThirteen(System);
        try
        {
            var target = thirteen switch
            {
                ThirteenMonthDate m => m.AddMonths(months).Gregorian,
                _ => SafeAdd(_date, months > 0 ? 1 : -1),
            };
            Go(target);
        }
        catch (ArgumentException)
        {
            // Past year 1 or 9999.
        }
    }

    /// <summary>Home and End: the first or last day of the month.</summary>
    public void MoveToMonthEdge(bool end)
    {
        if (_date.ToThirteen(System) is not ThirteenMonthDate m) return;
        Go(new ThirteenMonthDate(m.Year, m.Month, end ? 28 : 1, System).Gregorian);
    }

    private static GregorianDate SafeAdd(GregorianDate date, int days)
    {
        try
        {
            return date.AddDays(days);
        }
        catch (ArgumentException)
        {
            return date;
        }
    }

    private void Go(GregorianDate date)
    {
        if (!_field.InRange(date) || (_field.IsSkipped?.Invoke(date) ?? false)) return;
        _caption = null;
        Date = date;
        OnPropertyChanged(nameof(Caption));
        OnPropertyChanged(nameof(HasCaption));
    }

    // ---- Building ----------------------------------------------------------------------------------------

    private void Rebuild()
    {
        _rebuilding = true;
        try
        {
            var thirteen = _date.ToThirteen(System);
            var slots = ThirteenSlot.InYear(_date.Year, System).Select(s => Slot(s, System)).ToList();
            Slots = slots;
            var key = new ThirteenPickerLogic(System, _date).SlotKey;
            _selectedSlot = slots.FirstOrDefault(s => s.Key == key);
            OnPropertyChanged(nameof(SelectedSlot));
            if (thirteen is ThirteenMonthDate m)
            {
                var monthDays = ThirteenMonthDate.MonthDays(m.Year, m.Month, System);
                var gregorianWeekdays = MonthColumns.GregorianWeekdays(m.Year, m.Month, System);
                Columns = Enumerable.Range(0, 7).Select(c =>
                {
                    var weekday = new ThirteenMonthDate(m.Year, m.Month, c + 1, System).Weekday;
                    var gregorian = gregorianWeekdays[c];
                    return new PickerColumn(weekday.Name(NameStyle.Narrow), gregorian.Name(NameStyle.Narrow),
                        CalendarStrings.WeekdayA11y(weekday.Name(NameStyle.Long), gregorian.Name(NameStyle.Long)));
                }).ToList();
                Days = monthDays.Select(d =>
                {
                    var day = new PickerDay(d, System, d == _today, _field.InRange(d) && !(_field.IsSkipped?.Invoke(d) ?? false));
                    day.IsSelected = d == _date;
                    return day;
                }).ToList();
            }
            else
            {
                Days = [];
            }
            OnPropertyChanged(nameof(SelectedDay));
            OnPropertyChanged(nameof(IsIntercalary));
            OnPropertyChanged(nameof(ShowsGrid));
            OnPropertyChanged(nameof(BadgeCode));
            OnPropertyChanged(nameof(BadgeTitle));
            OnPropertyChanged(nameof(BadgeDetail));
            OnPropertyChanged(nameof(YearText));
            OnPropertyChanged(nameof(YearValueText));
            OnPropertyChanged(nameof(YearValue));
            OnPropertyChanged(nameof(Footer));
            OnPropertyChanged(nameof(GregorianSelection));
            PreviousYearCommand?.NotifyCanExecuteChanged();
            NextYearCommand?.NotifyCanExecuteChanged();
        }
        finally
        {
            _rebuilding = false;
        }
    }

    private static PickerSlot Slot(ThirteenSlot slot, CalendarSystemId system) => slot switch
    {
        ThirteenMonthSlot m => new PickerSlot(m.Key, m.MonthInfo.ShortName, EditorStrings.SlotMonth(m.MonthInfo.Name, m.Month), false, true),
        ThirteenIntercalarySlot i => new PickerSlot(i.Key, i.Occurrence.Code, SlotName(i.Occurrence, system), true, true),
        _ => new PickerSlot(slot.Key, slot.Key, slot.Key, false, false),
    };

    private static string SlotName(IntercalaryOccurrence occurrence, CalendarSystemId system)
    {
        if (system == CalendarSystemId.Ifc) return occurrence.LeapOnly ? EditorStrings.SlotLeapDay : EditorStrings.SlotYearDay;
        return EditorStrings.SlotFestival(occurrence.Name, occurrence.LeapOnly);
    }
}
