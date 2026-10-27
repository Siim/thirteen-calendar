using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>What a repeat picker row is.</summary>
public enum RepeatRowKind
{
    /// <summary>"Keep: {description}" (a repeat set in another app, §2.13).</summary>
    Keep,

    /// <summary>A preset (Never, the Gregorian and 13-month rows).</summary>
    Preset,

    /// <summary>"Custom".</summary>
    Custom,
}

/// <summary>One row of the repeat picker (§2.13): its label, and under the checked row the "Next:" line and the notes.</summary>
public sealed class RepeatRowViewModel : ViewModelBase
{
    private bool _isSelected;
    private string _next = "";
    private IReadOnlyList<string> _notes = [];

    internal RepeatRowViewModel(RepeatRowKind kind, string id, string label, EventRecurrence? recurrence, bool isEnabled = true)
    {
        Kind = kind;
        Id = id;
        Label = label;
        Recurrence = recurrence;
        IsEnabled = isEnabled;
    }

    /// <summary>What the row is.</summary>
    public RepeatRowKind Kind { get; }

    /// <summary>The preset id (<c>never</c>, <c>daily</c>, <c>thirteen-monthly</c>, ...), <c>keep</c> or <c>custom</c>.</summary>
    public string Id { get; }

    /// <summary>The row's text (from core's <c>repeatPresets</c>).</summary>
    public string Label { get; }

    /// <summary>The repeat it chooses (without end), or null for Never.</summary>
    public EventRecurrence? Recurrence { get; }

    /// <summary>A 13-month row a calendar cannot keep is disabled (never on Windows: local calendars keep every repeat).</summary>
    public bool IsEnabled { get; }

    /// <summary>The checked row.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>"Next: Mon, Oct 26; Mon, Nov 2; Mon, Nov 9" under the checked row, or "".</summary>
    public string Next
    {
        get => _next;
        set
        {
            if (SetProperty(ref _next, value)) OnPropertyChanged(nameof(HasNext));
        }
    }

    /// <summary>Whether the "Next:" line shows.</summary>
    public bool HasNext => _next.Length > 0;

    /// <summary>The notes under the checked row (core's <c>describeRepeatNotes</c>).</summary>
    public IReadOnlyList<string> Notes
    {
        get => _notes;
        set => SetProperty(ref _notes, value);
    }

    /// <summary>The row's accessible name: its label, then its "Next:" line and notes when checked.</summary>
    public string AccessibleName => string.Join(". ", new[] { Label, _next }.Concat(_notes).Where(t => t.Length > 0));
}

/// <summary>A section of the repeat picker: its header, rows and footer.</summary>
/// <param name="Header">"Gregorian calendar", the system's name, or "" for the rows without a header.</param>
/// <param name="Rows">The rows.</param>
/// <param name="Footer">The footer, or "".</param>
public sealed record RepeatSection(string Header, IReadOnlyList<RepeatRowViewModel> Rows, string Footer)
{
    /// <summary>Whether the header shows.</summary>
    public bool HasHeader => Header.Length > 0;

    /// <summary>Whether the footer shows.</summary>
    public bool HasFooter => Footer.Length > 0;
}

/// <summary>
/// The repeat picker (docs/EVENTS.md §2.13): Never, the Gregorian section, the 13-month section in the selected system's
/// name, Custom, and "Keep: ..." on top for a repeat Thirteen cannot edit. Labels come from core's
/// <see cref="RepeatPreset.All"/>, so they equal every other platform's. The checked row shows the next three dates and
/// the notes. Windows has no platform sentence (§2.13 table).
/// </summary>
public sealed class RepeatPickerViewModel : ViewModelBase
{
    private readonly GregorianDate _start;
    private readonly CalendarSystemId _system;
    private readonly RepeatEnd _end;

    /// <summary>
    /// A picker for a draft starting on <paramref name="start"/> whose repeat is <paramref name="current"/>; <paramref name="keep"/>
    /// is the stored repeat that Thirteen cannot edit (null when it can), shown as "Keep: ..." and checked while it is current.
    /// </summary>
    public RepeatPickerViewModel(GregorianDate start, CalendarSystemId system, EventRecurrence? current, EventRecurrence? keep)
    {
        _start = start;
        _system = system;
        _end = current?.End ?? RepeatEnd.Never;
        var presets = RepeatPreset.All(start, system);
        var sections = new List<RepeatSection>();
        var top = new List<RepeatRowViewModel>();
        if (keep is not null)
        {
            var description = keep.Describe(start, system);
            top.Add(new RepeatRowViewModel(RepeatRowKind.Keep, "keep", EditorStrings.RepeatKeep(description), keep));
        }
        foreach (var preset in presets.Where(p => p.Section == RepeatPresetSection.Never))
        {
            top.Add(new RepeatRowViewModel(RepeatRowKind.Preset, preset.Id, preset.Label, null));
        }
        sections.Add(new RepeatSection("", top, ""));
        sections.Add(new RepeatSection(EditorStrings.SectionGregorian,
            presets.Where(p => p.Section == RepeatPresetSection.Gregorian).Select(p => new RepeatRowViewModel(RepeatRowKind.Preset, p.Id, p.Label, p.Recurrence)).ToList(),
            EditorStrings.SectionGregorianFooter));
        sections.Add(new RepeatSection(system.Name(),
            presets.Where(p => p.Section == RepeatPresetSection.Thirteen).Select(p => new RepeatRowViewModel(RepeatRowKind.Preset, p.Id, p.Label, p.Recurrence)).ToList(),
            EditorStrings.SectionThirteenFooter));
        var custom = new RepeatRowViewModel(RepeatRowKind.Custom, "custom", EditorStrings.RepeatCustom,
            current is { Rule: RepeatRule.RRuleRepeat } && RepeatPreset.Match(current, start, system) is null ? current : null);
        sections.Add(new RepeatSection("", [custom], ""));
        Sections = sections;
        Rows = sections.SelectMany(s => s.Rows).ToList();

        // The checked row: Keep while the stored rule is current, else the matching preset, else Custom.
        RepeatRowViewModel? selected;
        if (keep is not null && Equals(current, keep)) selected = Rows[0];
        else
        {
            var id = RepeatPreset.Match(current, start, system);
            selected = id is null ? (current is null ? null : custom) : Rows.FirstOrDefault(r => r.Kind == RepeatRowKind.Preset && r.Id == id);
        }
        Select(selected, current);
        ChooseCommand = new RelayCommand<RepeatRowViewModel?>(row =>
        {
            if (row is null || !row.IsEnabled) return;
            Choose(row);
        });
    }

    /// <summary><c>repeat.title</c></summary>
    public string Title => EditorStrings.RepeatTitle;

    /// <summary>The sections in order.</summary>
    public IReadOnlyList<RepeatSection> Sections { get; }

    /// <summary>Every row in order.</summary>
    public IReadOnlyList<RepeatRowViewModel> Rows { get; }

    /// <summary>The checked row.</summary>
    public RepeatRowViewModel? Selected { get; private set; }

    /// <summary>A row was chosen: its repeat (with the draft's end; null for Never). Custom raises <see cref="CustomRequested"/> instead.</summary>
    public event Action<EventRecurrence?>? Chosen;

    /// <summary>"Custom" was chosen.</summary>
    public event Action? CustomRequested;

    /// <summary>Chooses a row (a click, Enter).</summary>
    public RelayCommand<RepeatRowViewModel?> ChooseCommand { get; }

    /// <summary>Chooses <paramref name="row"/>: a preset or Keep sets the repeat; Custom opens the Custom dialog.</summary>
    public void Choose(RepeatRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (row.Kind == RepeatRowKind.Custom)
        {
            CustomRequested?.Invoke();
            return;
        }
        var recurrence = row.Kind == RepeatRowKind.Keep ? row.Recurrence : WithEnd(row.Recurrence);
        Select(row, recurrence);
        Chosen?.Invoke(recurrence);
    }

    /// <summary>A preset's repeat with the draft's current end.</summary>
    public EventRecurrence? WithEnd(EventRecurrence? recurrence) => recurrence is null ? null : recurrence with { End = _end };

    private void Select(RepeatRowViewModel? row, EventRecurrence? recurrence)
    {
        foreach (var r in Rows)
        {
            r.IsSelected = ReferenceEquals(r, row);
            r.Next = "";
            r.Notes = [];
        }
        Selected = row;
        if (row is not null && recurrence is not null)
        {
            try
            {
                row.Next = recurrence.DescribeNext(_start, _system);
                row.Notes = recurrence.RepeatNotes(_start, _system);
            }
            catch (ThirteenException)
            {
                // A stored rule core cannot expand shows no next dates.
            }
        }
        OnPropertyChanged(nameof(Selected));
    }
}

/// <summary>
/// The Custom repeat dialog (docs/EVENTS.md §2.13, Gregorian only, like Apple Calendar): Frequency (Daily, Weekly,
/// Monthly, Yearly), "Every {n} days / weeks / months / years" (1 to 99), weekly weekday toggles, monthly "Each" days or
/// "On the" (first to fifth, last) x (Sunday to Saturday, day, weekday, weekend day), yearly months and an optional
/// "On the". The description, "Next:" line and notes update as the user edits.
/// </summary>
public sealed class CustomRepeatViewModel : ViewModelBase
{
    private const int WeekdaysMask = 0b0111110;
    private const int WeekendMask = 0b1000001;
    private const int AllDaysMask = 0b1111111;

    private readonly GregorianDate _start;
    private readonly CalendarSystemId _system;
    private readonly RepeatEnd _end;
    private int _frequency;
    private int _interval = 1;
    private bool _monthlyOnThe;
    private bool _yearlyOnThe;
    private int _ordinal;
    private int _dayKind;
    private string _description = "";
    private string _next = "";
    private IReadOnlyList<string> _notes = [];

    /// <summary>A Custom dialog for a draft starting on <paramref name="start"/>, opened on <paramref name="current"/> (a Gregorian rule) or the start's defaults.</summary>
    public CustomRepeatViewModel(GregorianDate start, CalendarSystemId system, EventRecurrence? current)
    {
        _start = start;
        _system = system;
        _end = current?.End ?? RepeatEnd.Never;
        Weekdays = Enumerable.Range(0, 7).Select(w => new ToggleOption(Weekday.Sunday.AdvancedBy(w).Name(NameStyle.Short), Weekday.Sunday.AdvancedBy(w).Name(NameStyle.Long), w == (int)start.Weekday, Update)).ToList();
        MonthDays = Enumerable.Range(1, 31).Select(d => new ToggleOption(d.ToString(System.Globalization.CultureInfo.InvariantCulture), d.ToString(System.Globalization.CultureInfo.InvariantCulture), d == start.Day, Update)).ToList();
        Months = Enumerable.Range(1, 12).Select(m => new ToggleOption(GregorianDate.MonthName(m, NameStyle.Short), GregorianDate.MonthName(m), m == start.Month, Update)).ToList();
        DayKindOptions = Enumerable.Range(0, 7).Select(w => Weekday.Sunday.AdvancedBy(w).Name()).Concat(EditorStrings.DayKinds).ToList();
        _dayKind = (int)start.Weekday;
        _ordinal = Math.Min(4, (start.Day - 1) / 7);
        if (current?.Rule is RepeatRule.RRuleRepeat { RRule: var rule }) Load(rule);
        DoneCommand = new RelayCommand(() => DoneRequested?.Invoke());
        Update();
    }

    private void Load(RRule rule)
    {
        _frequency = rule.Freq switch
        {
            Core.Events.Frequency.Weekly => 1,
            Core.Events.Frequency.Monthly => 2,
            Core.Events.Frequency.Yearly => 3,
            _ => 0,
        };
        _interval = Math.Clamp(rule.Interval, 1, 99);
        if (rule.ByDay.Count > 0 && rule.ByDay.All(d => d.Ordinal is null) && rule.BySetPos.Count == 0)
        {
            foreach (var option in Weekdays.Select((o, i) => (o, i))) option.o.SetQuietly(rule.ByDay.Any(d => (int)d.Weekday == option.i));
        }
        if (rule.ByMonthDay.Count > 0)
        {
            foreach (var option in MonthDays.Select((o, i) => (o, i))) option.o.SetQuietly(rule.ByMonthDay.Contains(option.i + 1));
        }
        if (rule.ByMonth.Count > 0)
        {
            foreach (var option in Months.Select((o, i) => (o, i))) option.o.SetQuietly(rule.ByMonth.Contains(option.i + 1));
        }
        var onThe = RecurrenceDescriptionsOnThe(rule);
        if (onThe is { } o)
        {
            if (_frequency == 2) _monthlyOnThe = true;
            if (_frequency == 3) _yearlyOnThe = true;
            _ordinal = o.Ordinal;
            _dayKind = o.Kind;
        }
    }

    private static (int Ordinal, int Kind)? RecurrenceDescriptionsOnThe(RRule rule)
    {
        if (rule.ByMonthDay.Count > 0) return null;
        static int? OrdinalIndex(int n) => n is >= 1 and <= 5 ? n - 1 : n == -1 ? 5 : null;
        if (rule.BySetPos.Count == 0 && rule.ByDay.Count == 1 && rule.ByDay[0].Ordinal is { } ord && OrdinalIndex(ord) is { } index)
        {
            return (index, (int)rule.ByDay[0].Weekday);
        }
        if (rule.BySetPos.Count == 1 && OrdinalIndex(rule.BySetPos[0]) is { } setIndex && rule.ByDay.All(d => d.Ordinal is null) && rule.ByDay.Count > 0)
        {
            var mask = rule.ByDay.Aggregate(0, (m, d) => m | (1 << (int)d.Weekday));
            int? kind = mask switch
            {
                AllDaysMask => 7,
                WeekdaysMask => 8,
                WeekendMask => 9,
                _ when (mask & (mask - 1)) == 0 => System.Numerics.BitOperations.Log2((uint)mask),
                _ => null,
            };
            return kind is { } k ? (setIndex, k) : null;
        }
        return null;
    }

    /// <summary><c>repeat.custom.frequency</c></summary>
    public string FrequencyLabel => EditorStrings.Frequency;

    /// <summary>Daily, Weekly, Monthly, Yearly.</summary>
    public IReadOnlyList<string> FrequencyOptions => EditorStrings.Frequencies;

    /// <summary>The chosen frequency (0 daily to 3 yearly).</summary>
    public int Frequency
    {
        get => _frequency;
        set
        {
            if (!SetProperty(ref _frequency, Math.Clamp(value, 0, 3))) return;
            OnPropertyChanged(nameof(IsWeekly));
            OnPropertyChanged(nameof(IsMonthly));
            OnPropertyChanged(nameof(IsYearly));
            Update();
        }
    }

    /// <summary><c>repeat.custom.every</c></summary>
    public string EveryLabel => EditorStrings.Every;

    /// <summary>"Every {n}" (1 to 99).</summary>
    public int Interval
    {
        get => _interval;
        set
        {
            if (!SetProperty(ref _interval, Math.Clamp(value, 1, 99))) return;
            OnPropertyChanged(nameof(IntervalValue));
            Update();
        }
    }

    /// <summary><see cref="Interval"/> for the number box.</summary>
    public decimal? IntervalValue
    {
        get => _interval;
        set => Interval = (int)Math.Round(value ?? 1);
    }

    /// <summary>The unit after the number: "days", "1 week".</summary>
    public string UnitText => EditorStrings.Unit(_frequency, _interval);

    /// <summary>The unit beside the number box, without the number: "days", "week".</summary>
    public string UnitWord => UnitText[(_interval.ToString(global::System.Globalization.CultureInfo.InvariantCulture).Length + 1)..];

    /// <summary>Weekly.</summary>
    public bool IsWeekly => _frequency == 1;

    /// <summary>Monthly.</summary>
    public bool IsMonthly => _frequency == 2;

    /// <summary>Yearly.</summary>
    public bool IsYearly => _frequency == 3;

    /// <summary>The weekday toggles, Sunday to Saturday (Gregorian).</summary>
    public IReadOnlyList<ToggleOption> Weekdays { get; }

    /// <summary>The month days 1 to 31 ("Each").</summary>
    public IReadOnlyList<ToggleOption> MonthDays { get; }

    /// <summary>The months (yearly).</summary>
    public IReadOnlyList<ToggleOption> Months { get; }

    /// <summary><c>repeat.custom.each</c></summary>
    public string EachLabel => EditorStrings.Each;

    /// <summary><c>repeat.custom.onThe</c></summary>
    public string OnTheLabel => EditorStrings.OnThe;

    /// <summary>Monthly: "On the" instead of "Each".</summary>
    public bool MonthlyOnThe
    {
        get => _monthlyOnThe;
        set
        {
            if (!SetProperty(ref _monthlyOnThe, value)) return;
            OnPropertyChanged(nameof(MonthlyEach));
            Update();
        }
    }

    /// <summary>Monthly: "Each".</summary>
    public bool MonthlyEach
    {
        get => !_monthlyOnThe;
        set => MonthlyOnThe = !value;
    }

    /// <summary>Yearly: with "On the".</summary>
    public bool YearlyOnThe
    {
        get => _yearlyOnThe;
        set
        {
            if (SetProperty(ref _yearlyOnThe, value)) Update();
        }
    }

    /// <summary>first, second, third, fourth, fifth, last.</summary>
    public IReadOnlyList<string> OrdinalOptions => EditorStrings.Ordinals;

    /// <summary>The chosen ordinal (0 first to 5 last).</summary>
    public int Ordinal
    {
        get => _ordinal;
        set
        {
            if (SetProperty(ref _ordinal, Math.Clamp(value, 0, 5))) Update();
        }
    }

    /// <summary>Sunday to Saturday, day, weekday, weekend day.</summary>
    public IReadOnlyList<string> DayKindOptions { get; }

    /// <summary>The chosen kind (0 to 6 a weekday, 7 day, 8 weekday, 9 weekend day).</summary>
    public int DayKind
    {
        get => _dayKind;
        set
        {
            if (SetProperty(ref _dayKind, Math.Clamp(value, 0, 9))) Update();
        }
    }

    /// <summary>The live description ("Every 2 weeks on Monday and Thursday").</summary>
    public string Description
    {
        get => _description;
        private set => SetProperty(ref _description, value);
    }

    /// <summary>The live "Next:" line.</summary>
    public string Next
    {
        get => _next;
        private set => SetProperty(ref _next, value);
    }

    /// <summary>The live notes.</summary>
    public IReadOnlyList<string> Notes
    {
        get => _notes;
        private set => SetProperty(ref _notes, value);
    }

    /// <summary><c>picker.done</c></summary>
    public string DoneText => EditorStrings.Done;

    /// <summary><c>editor.cancel</c></summary>
    public string CancelText => EditorStrings.Cancel;

    /// <summary><c>repeat.custom</c> (the dialog's title).</summary>
    public string Title => EditorStrings.RepeatCustom;

    /// <summary>Done.</summary>
    public RelayCommand DoneCommand { get; }

    /// <summary>Raised by Done.</summary>
    public event Action? DoneRequested;

    /// <summary>The repeat the dialog describes now (with the draft's end).</summary>
    public EventRecurrence Recurrence => new(RepeatRule.Of(BuildRule()), _end);

    private ValueList<WeekdayNum> OnTheDays()
    {
        var ordinal = _ordinal == 5 ? -1 : _ordinal + 1;
        return _dayKind switch
        {
            <= 6 => [new WeekdayNum((Weekday)_dayKind, ordinal)],
            7 => Enumerable.Range(0, 7).Select(w => new WeekdayNum((Weekday)w)).ToValueList(),
            8 => Enumerable.Range(1, 5).Select(w => new WeekdayNum((Weekday)w)).ToValueList(),
            _ => new[] { 0, 6 }.Select(w => new WeekdayNum((Weekday)w)).ToValueList(),
        };
    }

    private ValueList<int> OnTheSetPos() => _dayKind <= 6 ? ValueList<int>.Empty : [_ordinal == 5 ? -1 : _ordinal + 1];

    /// <summary>The Gregorian rule the controls describe.</summary>
    public RRule BuildRule()
    {
        switch (_frequency)
        {
            case 1:
            {
                var days = Weekdays.Select((o, i) => (o, i)).Where(x => x.o.IsChecked).Select(x => new WeekdayNum((Weekday)x.i)).ToValueList();
                if (days.Count == 0) days = [new WeekdayNum(_start.Weekday)];
                return new RRule(Core.Events.Frequency.Weekly) { Interval = _interval, ByDay = days };
            }
            case 2:
                if (_monthlyOnThe) return new RRule(Core.Events.Frequency.Monthly) { Interval = _interval, ByDay = OnTheDays(), BySetPos = OnTheSetPos() };
                {
                    var days = MonthDays.Select((o, i) => (o, i)).Where(x => x.o.IsChecked).Select(x => x.i + 1).ToValueList();
                    if (days.Count == 0) days = [_start.Day];
                    return new RRule(Core.Events.Frequency.Monthly) { Interval = _interval, ByMonthDay = days };
                }
            case 3:
            {
                var months = Months.Select((o, i) => (o, i)).Where(x => x.o.IsChecked).Select(x => x.i + 1).ToValueList();
                if (months.Count == 0) months = [_start.Month];
                if (_yearlyOnThe) return new RRule(Core.Events.Frequency.Yearly) { Interval = _interval, ByMonth = months, ByDay = OnTheDays(), BySetPos = OnTheSetPos() };
                return new RRule(Core.Events.Frequency.Yearly) { Interval = _interval, ByMonth = months, ByMonthDay = [_start.Day] };
            }
            default:
                return new RRule(Core.Events.Frequency.Daily) { Interval = _interval };
        }
    }

    private void Update()
    {
        OnPropertyChanged(nameof(UnitText));
        OnPropertyChanged(nameof(UnitWord));
        var recurrence = Recurrence;
        try
        {
            Description = recurrence.Describe(_start, _system);
            Next = recurrence.DescribeNext(_start, _system);
            Notes = recurrence.RepeatNotes(_start, _system);
        }
        catch (ThirteenException)
        {
            Description = EditorStrings.RepeatCustomUnknown;
            Next = "";
            Notes = [];
        }
    }
}

/// <summary>A toggle of the Custom dialog (a weekday, a month day, a month).</summary>
public sealed class ToggleOption : ViewModelBase
{
    private readonly Action _changed;
    private bool _isChecked;

    internal ToggleOption(string text, string name, bool isChecked, Action changed)
    {
        Text = text;
        Name = name;
        _isChecked = isChecked;
        _changed = changed;
    }

    /// <summary>The button's text ("Mon", "12", "Oct").</summary>
    public string Text { get; }

    /// <summary>Its accessible name ("Monday", "12", "October").</summary>
    public string Name { get; }

    /// <summary>Whether it is on.</summary>
    public bool IsChecked
    {
        get => _isChecked;
        set
        {
            if (SetProperty(ref _isChecked, value)) _changed();
        }
    }

    internal void SetQuietly(bool value)
    {
        _isChecked = value;
        OnPropertyChanged(nameof(IsChecked));
    }
}

/// <summary>A row of the Alert or Second alert picker (§2.14).</summary>
/// <param name="Label">"15 minutes before", "None", or an alert set elsewhere ("45 minutes before").</param>
/// <param name="Alarm">The alert, or null for None.</param>
public sealed record AlertOption(string Label, Alarm? Alarm)
{
    /// <inheritdoc />
    public override string ToString() => Label;

    /// <summary>
    /// The rows for an event: core's presets (§2.14; timed or all-day, 12 or 24-hour) and, when <paramref name="current"/>
    /// matches none of them, its own row so it is kept unless the user changes the picker.
    /// </summary>
    public static IReadOnlyList<AlertOption> For(bool allDay, Alarm? current, bool use24Hour, CalendarSystemId system)
    {
        var rows = Alarm.Presets(allDay, allowAfterStart: true, use24Hour).Select(p => new AlertOption(p.Label, p.Alarm)).ToList();
        if (current is not null && rows.All(r => r.Alarm != current)) rows.Add(new AlertOption(current.Describe(allDay, system, use24Hour), current));
        return rows;
    }
}
