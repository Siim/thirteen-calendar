using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// The day-detail pane: the full comparison of one day, with previous and next day (Alt+Left / Alt+Right),
/// back to today, and "Open in Convert". The Windows counterpart of the Apple apps' DayDetailSheet.
/// </summary>
public sealed class DayDetailViewModel : ViewModelBase
{
    private readonly MainViewModel _shell;
    private GregorianDate _date;
    private DayDetailContent _content;

    /// <summary>The pane for <paramref name="date"/>.</summary>
    public DayDetailViewModel(MainViewModel shell, GregorianDate date)
    {
        _shell = shell;
        _date = date;
        _content = Build();
        Events = new DayEventsViewModel(shell, date);
        PreviousDayCommand = new RelayCommand(() => Step(-1), () => _date > GregorianDate.MinValue);
        NextDayCommand = new RelayCommand(() => Step(1), () => _date < GregorianDate.MaxValue);
        TodayCommand = new RelayCommand(() => Date = _shell.State.Today, () => _date != _shell.State.Today);
        OpenInConverterCommand = new RelayCommand(() => _shell.OpenInConverter(_date));
        CloseCommand = new RelayCommand(_shell.CloseDetail);
    }

    /// <summary>The day shown.</summary>
    public GregorianDate Date
    {
        get => _date;
        set
        {
            if (!SetProperty(ref _date, value)) return;
            Events.Date = value;
            Refresh();
            _shell.DetailDateChanged(value);
        }
    }

    /// <summary>The Events section at the top (docs/EVENTS.md §2.9; task W9).</summary>
    public DayEventsViewModel Events { get; }

    /// <summary>Plate, title and facts.</summary>
    public DayDetailContent Content
    {
        get => _content;
        private set => SetProperty(ref _content, value);
    }

    /// <summary>Whether the day is not today (the Today button is shown).</summary>
    public bool IsNotToday => _date != _shell.State.Today;

    /// <summary>Alt+Left.</summary>
    public RelayCommand PreviousDayCommand { get; }

    /// <summary>Alt+Right.</summary>
    public RelayCommand NextDayCommand { get; }

    /// <summary>Back to today (only enabled on other days).</summary>
    public RelayCommand TodayCommand { get; }

    /// <summary>Opens the converter on this day.</summary>
    public RelayCommand OpenInConverterCommand { get; }

    /// <summary>Closes the pane (Esc).</summary>
    public RelayCommand CloseCommand { get; }

    /// <summary>Rebuilds for a new system or a new today.</summary>
    public void Refresh()
    {
        Content = Build();
        Events?.Refresh();
        OnPropertyChanged(nameof(IsNotToday));
        PreviousDayCommand?.NotifyCanExecuteChanged();
        NextDayCommand?.NotifyCanExecuteChanged();
        TodayCommand?.NotifyCanExecuteChanged();
    }

    private void Step(int delta)
    {
        if (delta < 0 && _date == GregorianDate.MinValue) return;
        if (delta > 0 && _date == GregorianDate.MaxValue) return;
        Date = _date.AddDays(delta);
    }

    private DayDetailContent Build() => new(_date, _shell.State.Today, _shell.State.System);
}

/// <summary>What the detail pane shows for one day.</summary>
public sealed class DayDetailContent
{
    /// <summary>Builds the pane's content.</summary>
    public DayDetailContent(GregorianDate date, GregorianDate today, CalendarSystemId system)
    {
        var comparison = new Comparison(date, system);
        Title = comparison.Thirteen.Format(FormatOptions.Medium);
        Plate = DatePlateModel.Create(comparison);
        Detail = new ComparisonDetailModel(comparison, relativeToToday: date == today);
    }

    /// <summary>"Oct 12, 2026" (the 13-month date).</summary>
    public string Title { get; }

    /// <summary>The compact plate.</summary>
    public DatePlateModel Plate { get; }

    /// <summary>The full comparison.</summary>
    public ComparisonDetailModel Detail { get; }
}
