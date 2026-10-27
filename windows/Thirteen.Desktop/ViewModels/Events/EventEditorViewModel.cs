using Avalonia.Media;
using Avalonia.Media.Immutable;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>What the editor is for (§2.11 titles).</summary>
public enum EditorMode
{
    /// <summary>"New event" with "Add" (also Duplicate).</summary>
    New,

    /// <summary>"Edit event" with "Save".</summary>
    Edit,

    /// <summary>"Edit alerts" (events before 1583 on Windows, §2.10): only Alert and Second alert.</summary>
    Alerts,
}

/// <summary>What the editor hands to the save routine.</summary>
/// <param name="Mode">New, edit or alerts.</param>
/// <param name="Draft">The draft as saved (default title and URL scheme applied).</param>
/// <param name="Original">The draft the editor opened with.</param>
/// <param name="Span">The span the user chose (<see cref="EditSpan.All"/> for a single event or a new one).</param>
/// <param name="Occurrence">The occurrence edited, or null for a new event.</param>
public sealed record EditorSaveRequest(EditorMode Mode, EventDraft Draft, EventDraft Original, EditSpan Span, IcsExpandedEvent? Occurrence);

/// <summary>A calendar of the editor's picker: writable calendars only (§2.15).</summary>
/// <param name="Id">The calendar id.</param>
/// <param name="Name">Its name (user text).</param>
/// <param name="Brush">Its color.</param>
/// <param name="Info">Its capabilities.</param>
public sealed record CalendarOption(string Id, string Name, IBrush Brush, CalendarInfo Info)
{
    /// <inheritdoc />
    public override string ToString() => Name;
}

/// <summary>The fields the editor can move focus to (Save with issues, §2.11 Validation).</summary>
public enum EditorField
{
    /// <summary>Title.</summary>
    Title,

    /// <summary>Starts.</summary>
    Starts,

    /// <summary>Ends.</summary>
    Ends,

    /// <summary>End repeat.</summary>
    EndRepeat,

    /// <summary>Calendar.</summary>
    Calendar,

    /// <summary>URL.</summary>
    Url,
}

/// <summary>
/// The event editor (docs/EVENTS.md §2.11; task W7) for a new event, an edit or the alerts of a historical event: the
/// fields and their order (board I1), the 13-month date fields with the midnight-end rule (§2.12), the repeat and its
/// end with every adaptation notice, the later-events and retime notices, the calendar picker, the two alert pickers,
/// Show as with the all-day default, validation under each field (announced, attached to its field, focus on Save),
/// the merge banner, the discard question on every closing path, and the span question before saving an occurrence.
/// Saving itself goes through the routine the window's actions give it (<see cref="EventActions"/>).
/// </summary>
public sealed class EventEditorViewModel : ViewModelBase
{
    private readonly IEventsUi _ui;
    private readonly Func<EditorSaveRequest, Task> _save;
    private readonly string _deviceZone;
    private readonly bool _use24Hour;
    private readonly ResolvedEvent? _resolved;
    private readonly EventDraft _original;
    private EventDraft _draft;
    private bool _availabilityTouched;
    private PreviousTimes? _previousTimes;
    private string? _zoneBeforeAllDay;
    private string? _repeatNotice;
    private string? _laterNotice;
    private string? _exceptionsNotice;
    private string? _alertNotice;
    private bool _changedElsewhere;
    private string? _saveErrorReason;
    private string? _saveErrorCode;
    private string _announcement = "";
    private bool _saving;
    private bool _closed;
    private bool _closeRaised;
    private IReadOnlyList<DraftIssue> _issues = [];
    private readonly HashSet<DraftIssue> _announced = [];
    private IReadOnlyList<AlertOption> _alertOptions = [];
    private IReadOnlyList<AlertOption> _secondAlertOptions = [];
    private int _endRepeatKind;
    private int _endRepeatCount = 10;

    /// <summary>
    /// An editor in <paramref name="mode"/> on <paramref name="draft"/> (for an edit: the occurrence's draft of
    /// <paramref name="resolved"/>), with the writable <paramref name="calendars"/> to choose from.
    /// </summary>
    public EventEditorViewModel(
        EditorMode mode,
        EventDraft draft,
        ResolvedEvent? resolved,
        IReadOnlyList<CalendarState> calendars,
        CalendarSystemId system,
        string deviceZone,
        Func<GregorianDate> today,
        IEventsUi ui,
        Func<EditorSaveRequest, Task> save,
        bool use24Hour = true,
        bool largeText = false)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(calendars);
        Mode = mode;
        System = system;
        _deviceZone = deviceZone;
        _ui = ui ?? throw new ArgumentNullException(nameof(ui));
        _save = save ?? throw new ArgumentNullException(nameof(save));
        _use24Hour = use24Hour;
        _resolved = resolved;
        LargeText = largeText;
        _original = draft.ToDraft();
        _draft = _original;
        Calendars = calendars.Where(c => c.IsWritable || c.Id == draft.CalendarId)
            .Select(c => new CalendarOption(c.Id, c.Name, BrushOf(c.Color), EventEditing.InfoOf(c))).ToList();
        StartField = new DateFieldViewModel(EditorStrings.Starts, system, draft.Start.Date, today);
        EndField = new DateFieldViewModel(EditorStrings.Ends, system, EndDisplayDate(draft), today);
        EndRepeatField = new DateFieldViewModel(EditorStrings.EndRepeat, system, EndRepeatDefault(draft), today);
        StartField.Changed += date => MoveStart(new LocalDateTime(date, _draft.AllDay ? 0 : _draft.Start.Minute));
        EndField.Changed += _ => SetEnd(EndField.Date, EndMinute);
        EndRepeatField.Changed += date => SetRecurrenceEnd(RepeatEnd.Until(date));
        StartField.IsSkipped = IsSkippedDay;
        EndField.IsSkipped = IsSkippedDay;
        switch (draft.Recurrence?.End)
        {
            case RepeatEnd.UntilEnd until:
                _endRepeatKind = 1;
                EndRepeatField.Date = until.Date;
                break;
            case RepeatEnd.CountEnd count:
                _endRepeatKind = 2;
                _endRepeatCount = count.Count;
                break;
        }

        SaveCommand = new AsyncRelayCommand(SaveAsync);
        CancelCommand = new AsyncRelayCommand(RequestCloseAsync);
        DeleteCommand = new RelayCommand(() => DeleteRequested?.Invoke(), () => Mode == EditorMode.Edit && _resolved is not null);
        RepeatCommand = new AsyncRelayCommand(OpenRepeatPickerAsync, () => CanEditRepeat);
        Refresh();
    }

    // ---- Shape ---------------------------------------------------------------------------------------------

    /// <summary>New, edit or alerts.</summary>
    public EditorMode Mode { get; }

    /// <summary>The 13-month system.</summary>
    public CalendarSystemId System { get; }

    /// <summary>150 % text and above: the date rows stack (§2.11).</summary>
    public bool LargeText { get; }

    /// <summary>The occurrence edited (null for a new event).</summary>
    public ResolvedEvent? Resolved => _resolved;

    /// <summary>"New event", "Edit event" or "Edit alerts".</summary>
    public string Title => Mode switch
    {
        EditorMode.New => EditorStrings.TitleNew,
        EditorMode.Alerts => EditorStrings.TitleAlerts,
        _ => EditorStrings.TitleEdit,
    };

    /// <summary>"Add" for a new event, else "Save".</summary>
    public string PrimaryText => Mode == EditorMode.New ? EditorStrings.Add : EditorStrings.Save;

    /// <summary>"Cancel".</summary>
    public string CancelText => EditorStrings.Cancel;

    /// <summary>"Ctrl+Enter saves".</summary>
    public string SaveHint => EditorStrings.SaveHint;

    /// <summary>"Delete event" (edit mode only).</summary>
    public string DeleteText => EditorStrings.EditorDelete;

    /// <summary>Whether "Delete event" shows (edit mode).</summary>
    public bool ShowsDelete => Mode == EditorMode.Edit && _resolved is not null;

    /// <summary>Whether every field shows (not the reduced "Edit alerts" form).</summary>
    public bool ShowsAllFields => Mode != EditorMode.Alerts;

    // ---- Labels ----------------------------------------------------------------------------------------------

    /// <summary><c>editor.titlePlaceholder</c></summary>
    public string TitleLabel => EditorStrings.TitlePlaceholder;

    /// <summary><c>editor.locationPlaceholder</c></summary>
    public string LocationLabel => EditorStrings.LocationPlaceholder;

    /// <summary><c>editor.allDay</c></summary>
    public string AllDayLabel => EditorStrings.AllDaySwitch;

    /// <summary><c>editor.starts</c></summary>
    public string StartsLabel => EditorStrings.Starts;

    /// <summary><c>editor.ends</c></summary>
    public string EndsLabel => EditorStrings.Ends;

    /// <summary><c>editor.repeat</c></summary>
    public string RepeatLabel => EditorStrings.RepeatLabel;

    /// <summary><c>editor.endRepeat</c></summary>
    public string EndRepeatLabel => EditorStrings.EndRepeat;

    /// <summary><c>editor.calendar</c></summary>
    public string CalendarLabel => EditorStrings.CalendarLabel;

    /// <summary><c>editor.alert</c></summary>
    public string AlertLabel => EditorStrings.Alert;

    /// <summary><c>editor.secondAlert</c></summary>
    public string SecondAlertLabel => EditorStrings.SecondAlert;

    /// <summary><c>editor.showAs</c></summary>
    public string ShowAsLabel => EditorStrings.ShowAsLabel;

    /// <summary><c>editor.urlPlaceholder</c></summary>
    public string UrlLabel => EditorStrings.UrlPlaceholder;

    /// <summary><c>editor.notes</c></summary>
    public string NotesLabel => EditorStrings.NotesLabel;

    /// <summary>The start time's accessible name ("Starts").</summary>
    public string StartTimeLabel => EditorStrings.Starts;

    /// <summary>The end time's accessible name ("Ends").</summary>
    public string EndTimeLabel => EditorStrings.Ends;

    // ---- Fields ----------------------------------------------------------------------------------------------

    /// <summary>Title (placeholder "Title"; empty is saved as "New event").</summary>
    public string EventTitle
    {
        get => _draft.Title;
        set => Update(_draft with { Title = value ?? "" });
    }

    /// <summary>Location.</summary>
    public string Location
    {
        get => _draft.Location;
        set => Update(_draft with { Location = value ?? "" });
    }

    /// <summary>URL (<c>https://</c> is added on save when a scheme is missing).</summary>
    public string Url
    {
        get => _draft.Url;
        set => Update(_draft with { Url = value ?? "" });
    }

    /// <summary>Notes.</summary>
    public string Notes
    {
        get => _draft.Notes;
        set => Update(_draft with { Notes = value ?? "" });
    }

    /// <summary>All-day (§2.11: on keeps the dates, drops the times and sets Free; off restores the times, the zone and Busy).</summary>
    public bool AllDay
    {
        get => _draft.AllDay;
        set
        {
            if (value == _draft.AllDay) return;
            if (value)
            {
                _previousTimes = new PreviousTimes(_draft.Start.Minute, Math.Clamp(EventTime.DisplayEnd(_draft.End).Minute, 0, 1440));
                _zoneBeforeAllDay = _draft.TimeZone;
            }
            var zone = _zoneBeforeAllDay ?? (Mode == EditorMode.New || _original.AllDay ? _deviceZone : _original.TimeZone);
            var next = Drafts.SetAllDay(SafeDraft(_draft), value, value ? null : _previousTimes, _availabilityTouched, value ? null : zone);
            Update(next with { Title = _draft.Title, Location = _draft.Location, Url = _draft.Url, Notes = _draft.Notes });
            SyncTimeFields();
            RebuildAlertOptions();
        }
    }

    /// <summary>The Starts date field.</summary>
    public DateFieldViewModel StartField { get; }

    /// <summary>The Ends date field (a midnight end shows the next day, §2.12).</summary>
    public DateFieldViewModel EndField { get; }

    /// <summary>The End repeat "On date" field.</summary>
    public DateFieldViewModel EndRepeatField { get; }

    /// <summary>The start time (hidden when all-day).</summary>
    public TimeSpan? StartTime
    {
        get => _draft.AllDay ? null : TimeSpan.FromMinutes(_draft.Start.Minute);
        set
        {
            if (value is not { } time || _draft.AllDay) return;
            var minute = Math.Clamp((int)time.TotalMinutes, 0, 1439);
            if (minute == _draft.Start.Minute) return;
            MoveStart(new LocalDateTime(_draft.Start.Date, minute));
        }
    }

    /// <summary>The end time (a midnight end shows 00:00 of the next day).</summary>
    public TimeSpan? EndTime
    {
        get => _draft.AllDay ? null : TimeSpan.FromMinutes(EndMinute);
        set
        {
            if (value is not { } time || _draft.AllDay) return;
            var minute = Math.Clamp((int)time.TotalMinutes, 0, 1439);
            if (minute == EndMinute) return;
            SetEnd(EndField.Date, minute);
        }
    }

    /// <summary>The time pickers' step: 5 minutes, or 1 when the stored value is not on a 5-minute step (§2.12).</summary>
    public int MinuteIncrement => _original.AllDay || (_original.Start.Minute % 5 == 0 && EventTime.DisplayEnd(_original.End).Minute % 5 == 0) ? 5 : 1;

    /// <summary>The time pickers use the 24-hour clock (the OS setting).</summary>
    public string ClockIdentifier => _use24Hour ? "24HourClock" : "12HourClock";

    /// <summary>Whether the time pickers show.</summary>
    public bool ShowsTimes => !_draft.AllDay;

    private int EndMinute => _draft.AllDay ? 0 : EventTime.DisplayEnd(_draft.End).Minute;

    /// <summary><c>editor.zoneNote</c> when the event's zone differs from the device's ("Times are in New York time."), or null.</summary>
    public string? ZoneNote => _draft.TimeZone is { } zone && zone != _deviceZone && !_draft.AllDay ? EditorStrings.ZoneNote(CityOf(zone)) : null;

    /// <summary>Whether the zone note shows.</summary>
    public bool HasZoneNote => ZoneNote is not null;

    /// <summary><c>editor.invitees.local</c> for an imported event with <c>ATTENDEE</c> lines, or null.</summary>
    public string? InviteesFooter => _resolved is { AttendeeCount: > 0 } && Mode != EditorMode.New ? EditorStrings.InviteesLocal : null;

    /// <summary>Whether the invitees footer shows.</summary>
    public bool HasInviteesFooter => InviteesFooter is not null;

    // ---- Repeat ----------------------------------------------------------------------------------------------

    /// <summary>The Repeat row's text: the description, or "Never".</summary>
    public string RepeatText => _draft.Recurrence is { } r ? Describe(r) : EditorStrings.RepeatNever;

    /// <summary>The Repeat row's accessible name: "Repeat, Every IFC month on the 12th".</summary>
    public string RepeatName => $"{EditorStrings.RepeatLabel}, {RepeatText}";

    /// <summary>An override shown on its own cannot repeat (<c>editor.repeat.instanceOnly</c>).</summary>
    public bool CanEditRepeat => !(_resolved?.Orphan ?? false);

    /// <summary><c>editor.repeat.instanceOnly</c> for an override shown on its own, or null.</summary>
    public string? RepeatInstanceOnly => CanEditRepeat ? null : EditorStrings.RepeatInstanceOnly;

    /// <summary>Whether the instance-only note shows.</summary>
    public bool HasRepeatInstanceOnly => !CanEditRepeat;

    /// <summary>The repeat notice (<c>editor.notice.repeatChanged</c>, <c>.repeatDropped</c>), or null.</summary>
    public string? RepeatNotice => _repeatNotice;

    /// <summary>Whether the repeat notice shows.</summary>
    public bool HasRepeatNotice => _repeatNotice is not null;

    /// <summary>The later-events line (<c>editor.notice.laterDeleted</c>, <c>.endless</c>, <c>.becomesSingle</c>), or null.</summary>
    public string? LaterNotice => _laterNotice;

    /// <summary>Whether the later-events line shows.</summary>
    public bool HasLaterNotice => _laterNotice is not null;

    /// <summary>The retime notice under Starts (<c>editor.notice.exceptionsRemoved</c>), or null.</summary>
    public string? ExceptionsNotice => _exceptionsNotice;

    /// <summary>Whether the retime notice shows.</summary>
    public bool HasExceptionsNotice => _exceptionsNotice is not null;

    /// <summary>Opens the repeat picker.</summary>
    public AsyncRelayCommand RepeatCommand { get; }

    /// <summary>Whether End repeat shows: a repeat whose end Thirteen writes (a preset or Custom, not a kept foreign rule).</summary>
    public bool ShowsEndRepeat => _draft.Recurrence?.Rule is RepeatRule.RRuleRepeat or RepeatRule.ThirteenRepeat;

    /// <summary>"Never", "On date", "After".</summary>
    public IReadOnlyList<string> EndRepeatOptions { get; } = [EditorStrings.EndRepeatNever, EditorStrings.EndRepeatOnDate, EditorStrings.EndRepeatAfter];

    /// <summary>The End repeat kind: 0 Never, 1 On date, 2 After.</summary>
    public int EndRepeatKind
    {
        get => _endRepeatKind;
        set
        {
            value = Math.Clamp(value, 0, 2);
            if (_endRepeatKind == value) return;
            _endRepeatKind = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(EndRepeatOnDate));
            OnPropertyChanged(nameof(EndRepeatAfter));
            SetRecurrenceEnd(value switch
            {
                1 => RepeatEnd.Until(EndRepeatField.Date),
                2 => RepeatEnd.AfterCount(_endRepeatCount),
                _ => RepeatEnd.Never,
            });
        }
    }

    /// <summary>"On date": the date field shows.</summary>
    public bool EndRepeatOnDate => _endRepeatKind == 1;

    /// <summary>"After": the count shows.</summary>
    public bool EndRepeatAfter => _endRepeatKind == 2;

    /// <summary>"After {n} times" (1 to 999).</summary>
    public decimal? EndRepeatCount
    {
        get => _endRepeatCount;
        set
        {
            if (value is not { } v) return;
            var count = (int)Math.Clamp(Math.Round(v), 0, 100000);
            if (count == _endRepeatCount) return;
            _endRepeatCount = count;
            OnPropertyChanged();
            OnPropertyChanged(nameof(EndRepeatTimesText));
            if (_endRepeatKind == 2) SetRecurrenceEnd(RepeatEnd.AfterCount(count));
        }
    }

    /// <summary>"times" after the count ("10 times").</summary>
    public string EndRepeatTimesText => EditorStrings.Times(_endRepeatCount)[(_endRepeatCount.ToString(global::System.Globalization.CultureInfo.InvariantCulture).Length + 1)..];

    // ---- Calendar, alerts, show as ----------------------------------------------------------------------------

    /// <summary>The writable calendars.</summary>
    public IReadOnlyList<CalendarOption> Calendars { get; }

    /// <summary>The chosen calendar.</summary>
    public CalendarOption? SelectedCalendar
    {
        get => Calendars.FirstOrDefault(c => c.Id == _draft.CalendarId);
        set
        {
            if (value is null || value.Id == _draft.CalendarId) return;
            var next = _draft with { CalendarId = value.Id };
            // A calendar that keeps fewer alerts trims them at once, and says so (§2.11).
            _alertNotice = null;
            if (value.Info.MaxAlarms is { } max && next.Alarms.Count > max)
            {
                next = next with { Alarms = next.Alarms.Take(max).ToValueList() };
                _alertNotice = max == 0 ? EditorStrings.NoticeAlertsRemoved(value.Name) : EditorStrings.NoticeAlertsTrimmed(value.Name);
                Announce(_alertNotice);
            }
            Update(next);
            RebuildAlertOptions();
        }
    }

    /// <summary>The Calendar row's accessible name.</summary>
    public string CalendarName => SelectedCalendar is { } c ? $"{EditorStrings.CalendarLabel}, {c.Name}" : EditorStrings.CalendarLabel;

    /// <summary>The Alert picker's rows.</summary>
    public IReadOnlyList<AlertOption> AlertOptions
    {
        get => _alertOptions;
        private set => SetProperty(ref _alertOptions, value);
    }

    /// <summary>The Second alert picker's rows.</summary>
    public IReadOnlyList<AlertOption> SecondAlertOptions
    {
        get => _secondAlertOptions;
        private set => SetProperty(ref _secondAlertOptions, value);
    }

    /// <summary>The first alert (None when there is none).</summary>
    public AlertOption? SelectedAlert
    {
        get => _alertOptions.FirstOrDefault(o => o.Alarm == (_draft.Alarms.Count > 0 ? _draft.Alarms[0] : null));
        set
        {
            if (value is null) return;
            // None on the first alert moves the second one up (it is never dropped silently).
            var rest = _draft.Alarms.Skip(1).ToList();
            var alarms = value.Alarm is null ? rest : [value.Alarm, .. rest];
            Update(_draft with { Alarms = alarms.ToValueList() });
            RebuildAlertOptions();
        }
    }

    /// <summary>The second alert (None when there is none).</summary>
    public AlertOption? SelectedSecondAlert
    {
        get => _secondAlertOptions.FirstOrDefault(o => o.Alarm == (_draft.Alarms.Count > 1 ? _draft.Alarms[1] : null));
        set
        {
            if (value is null || _draft.Alarms.Count == 0) return;
            var alarms = new List<Alarm> { _draft.Alarms[0] };
            if (value.Alarm is not null) alarms.Add(value.Alarm);
            alarms.AddRange(_draft.Alarms.Skip(2));
            Update(_draft with { Alarms = alarms.ToValueList() });
            RebuildAlertOptions();
        }
    }

    /// <summary>Second alert appears once Alert is set and the calendar keeps more than one alert.</summary>
    public bool ShowsSecondAlert => _draft.Alarms.Count > 0 && (SelectedCalendar?.Info.MaxAlarms ?? int.MaxValue) > 1;

    /// <summary>The alerts notice (<c>editor.notice.alertsTrimmed</c>, <c>.alertsRemoved</c>), or null.</summary>
    public string? AlertNotice => _alertNotice;

    /// <summary>Whether the alerts notice shows.</summary>
    public bool HasAlertNotice => _alertNotice is not null;

    /// <summary>"Busy", "Free".</summary>
    public IReadOnlyList<string> ShowAsOptions { get; } = [EditorStrings.Busy, EditorStrings.Free];

    /// <summary>Show as: 0 Busy, 1 Free (-1 for a value set elsewhere, kept until changed).</summary>
    public int ShowAsIndex
    {
        get => _draft.Availability switch
        {
            Availability.Busy => 0,
            Availability.Free => 1,
            _ => -1,
        };
        set
        {
            if (value is not (0 or 1)) return;
            var availability = value == 1 ? Availability.Free : Availability.Busy;
            _availabilityTouched = true;
            if (availability != _draft.Availability) Update(_draft with { Availability = availability });
        }
    }

    /// <summary>Show as shows only when the calendar keeps it (§2.11).</summary>
    public bool ShowsShowAs => SelectedCalendar?.Info.SupportsAvailability ?? true;

    // ---- Validation, banner, errors ------------------------------------------------------------------------------

    /// <summary>The issues shown now (of the groups the user changed, for an edit).</summary>
    public IReadOnlyList<DraftIssue> Issues => _issues;

    /// <summary>The Starts error (<c>editor.error.outOfRange</c>), or null.</summary>
    public string? StartError => StartField.Error ?? (_issues.Contains(DraftIssue.OutOfRange) && _draft.Start.Date < DateFieldViewModel.EarliestEditable ? EditorStrings.ErrorOutOfRange : null);

    /// <summary>The Ends error (<c>editor.error.endBeforeStart</c>, <c>.outOfRange</c>), or null.</summary>
    public string? EndError => EndField.Error
        ?? (_issues.Contains(DraftIssue.EndBeforeStart) ? EditorStrings.ErrorEndBeforeStart
            : _issues.Contains(DraftIssue.OutOfRange) && _draft.Start.Date >= DateFieldViewModel.EarliestEditable ? EditorStrings.ErrorOutOfRange : null);

    /// <summary>The End repeat error (<c>editor.error.untilBeforeStart</c>, <c>.countRange</c>), or null.</summary>
    public string? EndRepeatError => EndRepeatField.Error
        ?? (_issues.Contains(DraftIssue.UntilBeforeStart) ? EditorStrings.ErrorUntilBeforeStart
            : _issues.Contains(DraftIssue.CountOutOfRange) ? EditorStrings.ErrorCountRange(999) : null);

    /// <summary>The URL error (<c>editor.error.url</c>), or null.</summary>
    public string? UrlError => _issues.Contains(DraftIssue.InvalidUrl) ? EditorStrings.ErrorUrl : null;

    /// <summary>The Calendar error (<c>editor.error.readOnlyCalendar</c>), or null.</summary>
    public string? CalendarError => _issues.Contains(DraftIssue.CalendarReadOnly) ? EditorStrings.ErrorReadOnlyCalendar : null;

    /// <summary>Whether the Starts error shows.</summary>
    public bool HasStartError => StartError is not null;

    /// <summary>Whether the Ends error shows.</summary>
    public bool HasEndError => EndError is not null;

    /// <summary>Whether the End repeat error shows.</summary>
    public bool HasEndRepeatError => EndRepeatError is not null;

    /// <summary>Whether the URL error shows.</summary>
    public bool HasUrlError => UrlError is not null;

    /// <summary>Whether the Calendar error shows.</summary>
    public bool HasCalendarError => CalendarError is not null;

    /// <summary>The banner <c>editor.changedElsewhere</c> is shown.</summary>
    public bool ChangedElsewhere
    {
        get => _changedElsewhere;
        private set => SetProperty(ref _changedElsewhere, value);
    }

    /// <summary><c>editor.changedElsewhere</c></summary>
    public string ChangedElsewhereText => EditorStrings.ChangedElsewhere;

    /// <summary><c>editor.saveFailed.title</c></summary>
    public string SaveErrorTitle => EditorStrings.SaveFailedTitle;

    /// <summary>A save error's reason line (<c>editor.saveFailed.*</c>), or null.</summary>
    public string? SaveErrorReason
    {
        get => _saveErrorReason;
        private set
        {
            if (SetProperty(ref _saveErrorReason, value)) OnPropertyChanged(nameof(HasSaveError));
        }
    }

    /// <summary>The technical code under the reason (Geist Mono): "IOException", "EventStore Transient".</summary>
    public string? SaveErrorCode
    {
        get => _saveErrorCode;
        private set => SetProperty(ref _saveErrorCode, value);
    }

    /// <summary>Whether a save error shows.</summary>
    public bool HasSaveError => _saveErrorReason is not null;

    /// <summary>The latest polite announcement (an issue or notice appearing; the live region reads it).</summary>
    public string Announcement
    {
        get => _announcement;
        private set => SetProperty(ref _announcement, value);
    }

    // ---- Commands and events ---------------------------------------------------------------------------------------

    /// <summary>"Add" / "Save" (and Ctrl+Enter).</summary>
    public AsyncRelayCommand SaveCommand { get; }

    /// <summary>"Cancel", Escape, the close button, Alt+F4: asks first when the draft changed.</summary>
    public AsyncRelayCommand CancelCommand { get; }

    /// <summary>"Delete event".</summary>
    public RelayCommand DeleteCommand { get; }

    /// <summary>Raised when the dialog should close (saved, discarded, deleted elsewhere).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Raised when focus should move to a field (Save with issues).</summary>
    public event Action<EditorField>? FocusRequested;

    /// <summary>Raised by "Delete event" (the actions ask the delete question and close the editor when it is answered).</summary>
    public event Action? DeleteRequested;

    /// <summary>Whether the dialog has closed.</summary>
    public bool IsClosed => _closed;

    /// <summary>Whether it was closed by a save.</summary>
    public bool Saved { get; private set; }

    /// <summary>The draft as the user has it now.</summary>
    public EventDraft Draft => _draft;

    /// <summary>The draft the editor opened with.</summary>
    public EventDraft Original => _original;

    /// <summary>"Changed" means different from the draft the editor opened with (§2.11).</summary>
    public bool IsDirty => DraftMerge.ChangedFields(SafeDraft(_original), SafeDraft(_draft)).Count > 0;

    // ---- Editing rules -------------------------------------------------------------------------------------------

    /// <summary>
    /// Changing Starts (§2.11): the end moves by the same amount, and the repeat is re-derived from the new start with the
    /// notice of the §2.11 table, so no change of repeat kind is ever silent.
    /// </summary>
    public void MoveStart(LocalDateTime start)
    {
        if (_draft.AllDay) start = new LocalDateTime(start.Date, 0);
        var moved = Drafts.MoveStart(SafeDraft(_draft), start, System);
        var next = moved.Draft with { Title = _draft.Title, Location = _draft.Location, Url = _draft.Url, Notes = _draft.Notes };
        _repeatNotice = moved.RepeatChange switch
        {
            RepeatChange.Converted when next.Recurrence is { } r => EditorStrings.NoticeRepeatChanged(Describe(r, next.Start.Date)),
            RepeatChange.Dropped => EditorStrings.NoticeRepeatDropped(start.Date.ToThirteen(System) is ThirteenIntercalaryDate i ? i.Info.Name : ""),
            _ => null,
        };
        if (_repeatNotice is not null) Announce(_repeatNotice);
        if (moved.RepeatChange == RepeatChange.Dropped) _endRepeatKind = 0;
        Update(next);
        SyncTimeFields();
    }

    /// <summary>Changing Ends never moves Starts; a midnight end is stored as 24:00 of the day before (§2.12).</summary>
    public void SetEnd(GregorianDate date, int minute)
    {
        LocalDateTime end;
        if (_draft.AllDay)
        {
            end = new LocalDateTime(date, 1440);
        }
        else
        {
            end = new LocalDateTime(date, minute);
            if (end >= _draft.Start) end = EventTime.NormalizeEnd(_draft.Start, end);
        }
        Update(_draft with { End = end });
        SyncTimeFields();
    }

    /// <summary>Chooses a repeat (the picker's row or Custom).</summary>
    public void SetRecurrence(EventRecurrence? recurrence)
    {
        _repeatNotice = null;
        _endRepeatKind = recurrence?.End switch
        {
            RepeatEnd.UntilEnd => 1,
            RepeatEnd.CountEnd => 2,
            _ => 0,
        };
        if (recurrence?.End is RepeatEnd.UntilEnd until) EndRepeatField.Date = until.Date;
        if (recurrence?.End is RepeatEnd.CountEnd count) _endRepeatCount = count.Count;
        Update(_draft with { Recurrence = recurrence });
        OnPropertyChanged(nameof(EndRepeatKind));
        OnPropertyChanged(nameof(EndRepeatOnDate));
        OnPropertyChanged(nameof(EndRepeatAfter));
        OnPropertyChanged(nameof(EndRepeatCount));
    }

    private void SetRecurrenceEnd(RepeatEnd end)
    {
        if (_draft.Recurrence is not { } recurrence) return;
        Update(_draft with { Recurrence = recurrence with { End = end } });
    }

    /// <summary>Opens the repeat picker (and Custom from it).</summary>
    public async Task OpenRepeatPickerAsync()
    {
        if (!CanEditRepeat) return;
        var keep = _resolved is { RepeatEditable: false } ? _resolved.Recurrence : null;
        var picker = new RepeatPickerViewModel(_draft.Start.Date, System, _draft.Recurrence, keep);
        EventRecurrence? chosen = _draft.Recurrence;
        var custom = false;
        picker.Chosen += r => chosen = r;
        picker.CustomRequested += () => custom = true;
        var done = await _ui.ShowRepeatPickerAsync(picker);
        if (custom)
        {
            var dialog = new CustomRepeatViewModel(_draft.Start.Date, System, _draft.Recurrence?.Rule is RepeatRule.RRuleRepeat ? _draft.Recurrence : null);
            if (await _ui.ShowCustomRepeatAsync(dialog)) SetRecurrence(dialog.Recurrence);
            return;
        }
        if (done) SetRecurrence(chosen);
    }

    private void Update(EventDraft next)
    {
        _draft = next;
        _saveErrorReason = null;
        Refresh();
    }

    /// <summary>Recomputes everything derived from the draft (notices, issues, rows) and raises the changes.</summary>
    private void Refresh()
    {
        StartField.StepsLeapYears = _draft.Recurrence?.Rule is RepeatRule.ThirteenRepeat { Rule: ThirteenRule.Intercalary }
            && _draft.Start.Date.ToThirteen(System) is ThirteenIntercalaryDate { Info.LeapOnly: true };
        _laterNotice = LaterLine();
        var exceptions = ExceptionsLine();
        if (exceptions is not null && exceptions != _exceptionsNotice) Announce(exceptions);
        _exceptionsNotice = exceptions;
        if (_alertOptions.Count == 0) RebuildAlertOptions();
        UpdateIssues();
        OnPropertyChanged(string.Empty);
    }

    private string? LaterLine()
    {
        if (Mode != EditorMode.Edit || _resolved is not { IsRepeating: true } resolved) return null;
        if (_draft.Recurrence is not null || _original.Recurrence is null) return null;
        if (resolved.IsFirst) return EditorStrings.NoticeBecomesSingle(EditorStrings.LongDate(_draft.Start.Date, System));
        var later = EventEditing.LaterCount(resolved);
        return later is null ? EditorStrings.NoticeLaterDeletedEndless : later > 0 ? EditorStrings.NoticeLaterDeleted(later.Value) : null;
    }

    private string? ExceptionsLine()
    {
        if (Mode != EditorMode.Edit || _resolved is not { IsRepeating: true, IsFirst: true } resolved) return null;
        var startChanged = _draft.Start != _original.Start || _draft.AllDay != _original.AllDay;
        if (!startChanged) return null;
        var dropped = EventEditing.RetimeDropped(resolved, SafeDraft(_draft));
        return dropped > 0 ? EditorStrings.NoticeExceptionsRemoved(dropped) : null;
    }

    private void UpdateIssues()
    {
        var calendar = SelectedCalendar;
        if (calendar is null)
        {
            _issues = [];
            return;
        }
        var draft = SafeDraft(_draft);
        IReadOnlyList<DraftIssue> issues;
        try
        {
            var written = Mode == EditorMode.New ? null : DraftMerge.ChangedFields(SafeDraft(_original), draft);
            issues = EventEditing.IssuesFor(draft, calendar.Info, written);
        }
        catch (ThirteenException)
        {
            issues = [];
        }
        // Fixed by themselves: alerts are trimmed when the calendar changes, a repeat is re-derived from its start.
        _issues = issues.Where(i => i is not DraftIssue.TooManyAlarms and not DraftIssue.RepeatNotOnStart).ToList();
        foreach (var issue in _issues)
        {
            if (_announced.Add(issue) && IssueText(issue) is { } text) Announce(text);
        }
        _announced.IntersectWith(_issues);
    }

    private string? IssueText(DraftIssue issue) => issue switch
    {
        DraftIssue.EndBeforeStart => EditorStrings.ErrorEndBeforeStart,
        DraftIssue.OutOfRange => EditorStrings.ErrorOutOfRange,
        DraftIssue.UntilBeforeStart => EditorStrings.ErrorUntilBeforeStart,
        DraftIssue.CountOutOfRange => EditorStrings.ErrorCountRange(999),
        DraftIssue.InvalidUrl => EditorStrings.ErrorUrl,
        DraftIssue.CalendarReadOnly => EditorStrings.ErrorReadOnlyCalendar,
        _ => null,
    };

    private static EditorField? FieldOf(DraftIssue issue, EventDraft draft) => issue switch
    {
        DraftIssue.EndBeforeStart => EditorField.Ends,
        DraftIssue.OutOfRange => draft.Start.Date < DateFieldViewModel.EarliestEditable ? EditorField.Starts : EditorField.Ends,
        DraftIssue.UntilBeforeStart or DraftIssue.CountOutOfRange => EditorField.EndRepeat,
        DraftIssue.InvalidUrl => EditorField.Url,
        DraftIssue.CalendarReadOnly => EditorField.Calendar,
        _ => null,
    };

    private void Announce(string text)
    {
        // The same text twice is a change too: clear first so the live region fires again.
        Announcement = "";
        Announcement = text;
    }

    private void RebuildAlertOptions()
    {
        var first = _draft.Alarms.Count > 0 ? _draft.Alarms[0] : null;
        var second = _draft.Alarms.Count > 1 ? _draft.Alarms[1] : null;
        AlertOptions = AlertOption.For(_draft.AllDay, first, _use24Hour, System);
        SecondAlertOptions = AlertOption.For(_draft.AllDay, second, _use24Hour, System);
        OnPropertyChanged(nameof(SelectedAlert));
        OnPropertyChanged(nameof(SelectedSecondAlert));
        OnPropertyChanged(nameof(ShowsSecondAlert));
    }

    private void SyncTimeFields()
    {
        StartField.Date = _draft.Start.Date;
        EndField.Date = EndDisplayDate(_draft);
        OnPropertyChanged(nameof(StartTime));
        OnPropertyChanged(nameof(EndTime));
    }

    /// <summary>The Ends field's date: an all-day event's last day; a timed end at midnight is the next day at 00:00 (§2.12).</summary>
    private static GregorianDate EndDisplayDate(EventDraft draft)
    {
        if (draft.AllDay) return draft.End.Minute == 0 && draft.End.Date > draft.Start.Date ? draft.End.Date.AddDays(-1) : draft.End.Date;
        try
        {
            return EventTime.DisplayEnd(draft.End).Date;
        }
        catch (ArgumentException)
        {
            return draft.End.Date;
        }
    }

    private static GregorianDate EndRepeatDefault(EventDraft draft)
    {
        try
        {
            return draft.Start.Date.AddDays(28);
        }
        catch (ArgumentException)
        {
            return draft.Start.Date;
        }
    }

    /// <summary>A draft core accepts for its rules: an end before its start is kept as the start for the shape checks.</summary>
    private static EventDraft SafeDraft(EventDraft draft) => draft;

    private string Describe(EventRecurrence recurrence, GregorianDate? start = null)
    {
        try
        {
            return recurrence.Describe(start ?? _draft.Start.Date, System);
        }
        catch (ThirteenException)
        {
            return EditorStrings.RepeatCustomUnknown;
        }
    }

    private bool IsSkippedDay(GregorianDate day)
    {
        if (_draft.AllDay || _draft.TimeZone is not { } zone) return false;
        try
        {
            var start = ZoneMath.ToUtc(new LocalDateTime(day, 0), zone, Zones);
            var next = ZoneMath.ToUtc(new LocalDateTime(day.AddDays(1), 0), zone, Zones);
            return start is { } a && next is { } b && a == b;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    /// <summary>The zone data used for the skipped-day check (the window's store).</summary>
    public IZoneResolver Zones { get; init; } = WindowsZoneResolver.Shared;

    /// <summary>"New York" for <c>America/New_York</c>: the last part of the zone id, underscores as spaces.</summary>
    public static string CityOf(string zone)
    {
        const string fileZone = "ics:VTIMEZONE:";
        var name = zone == "ics:UTC" ? "UTC" : zone.StartsWith(fileZone, StringComparison.Ordinal) ? zone[fileZone.Length..] : zone;
        var slash = name.LastIndexOf('/');
        return (slash >= 0 ? name[(slash + 1)..] : name).Replace('_', ' ');
    }

    private static IBrush BrushOf(string color) =>
        Color.TryParse(color, out var parsed) ? new ImmutableSolidColorBrush(parsed) : new ImmutableSolidColorBrush(Colors.Gray);

    // ---- Changes elsewhere (§2.11 "Saving is a three-way merge") -------------------------------------------------

    /// <summary>
    /// The store changed while the editor is open: <paramref name="current"/> is the occurrence resolved again (null when it
    /// no longer resolves) and <paramref name="groupExists"/> whether its event still exists. A deleted event closes the
    /// editor with <c>editor.deletedElsewhere</c>; a group changed both here and elsewhere shows the banner.
    /// </summary>
    public async Task OnStoreChangedAsync(ResolvedEvent? current, bool groupExists)
    {
        if (_closed || Mode == EditorMode.New || _resolved is null) return;
        if (!groupExists)
        {
            _closed = true;
            await _ui.AlertAsync(EditorStrings.DeletedElsewhere);
            Close();
            return;
        }
        if (current is null) return;
        try
        {
            var merge = DraftMerge.Merge(SafeDraft(_original), SafeDraft(_draft), current.Draft);
            ChangedElsewhere = merge.Conflicts.Count > 0;
        }
        catch (ThirteenException)
        {
            // A draft with an end before its start cannot be merged yet; the banner waits for the next change.
        }
    }

    // ---- Saving and closing --------------------------------------------------------------------------------------

    /// <summary>The draft as it is saved: an empty title is "New event", a URL without a scheme gets <c>https://</c>.</summary>
    public EventDraft FinalDraft()
    {
        var draft = _draft;
        if (Mode == EditorMode.New && draft.Title.Trim().Length == 0) draft = draft with { Title = EditorStrings.DefaultTitle };
        else if (Mode == EditorMode.Edit && draft.Title.Trim().Length == 0 && _original.Title.Length > 0) draft = draft with { Title = EditorStrings.DefaultTitle };
        var url = draft.Url.Trim();
        if (url.Length > 0 && url != _original.Url && !HasScheme(url)) draft = draft with { Url = "https://" + url };
        return draft;
    }

    private static bool HasScheme(string url)
    {
        var colon = url.IndexOf(':', StringComparison.Ordinal);
        if (colon <= 0) return false;
        return char.IsAsciiLetter(url[0]) && url[..colon].All(c => char.IsAsciiLetterOrDigit(c) || c is '+' or '.' or '-')
            && (url.Length > colon + 2 && url.AsSpan(colon + 1).StartsWith("//") || url[..colon].Equals("mailto", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Save (§2.11): with issues nothing is saved and focus goes to the first field with one; on an occurrence of a series
    /// the span question comes first; a gone occurrence closes with <c>editor.occurrenceGone</c>; other failures show
    /// "Couldn't save the event" with a reason line and a technical code. True when saved.
    /// </summary>
    public async Task<bool> SaveAsync()
    {
        if (_saving || _closed) return false;
        var draft = FinalDraft();
        UpdateIssues();
        var issues = _issues.ToList();
        if (StartField.HasError || EndField.HasError || EndRepeatField.HasError || issues.Count > 0)
        {
            OnPropertyChanged(string.Empty);
            var field = StartField.HasError ? EditorField.Starts
                : EndField.HasError ? EditorField.Ends
                : EndRepeatField.HasError ? EditorField.EndRepeat
                : issues.Select(i => FieldOf(i, _draft)).FirstOrDefault(f => f is not null) ?? EditorField.Title;
            var text = StartField.Error ?? EndField.Error ?? EndRepeatField.Error ?? issues.Select(IssueText).FirstOrDefault(t => t is not null);
            FocusRequested?.Invoke(field);
            if (text is not null) Announce(text);
            return false;
        }
        var span = EditSpan.All;
        if (Mode == EditorMode.Edit && _resolved is { IsRepeating: true } resolved)
        {
            var question = SpanQuestions.ForSave(resolved, _original, draft);
            var answer = await _ui.ChooseAsync(question.Question);
            if (answer is not { } index || _closed) return false;
            span = question.Spans[index];
        }
        _saving = true;
        try
        {
            await _save(new EditorSaveRequest(Mode, draft, _original, span, _resolved?.Occurrence));
            Saved = true;
            Close();
            return true;
        }
        catch (InvalidDraftException e)
        {
            _issues = e.Issues.Where(i => i is not DraftIssue.TooManyAlarms and not DraftIssue.RepeatNotOnStart).ToList();
            OnPropertyChanged(string.Empty);
            if (_issues.Count > 0)
            {
                if (FieldOf(_issues[0], _draft) is { } field) FocusRequested?.Invoke(field);
                if (IssueText(_issues[0]) is { } text) Announce(text);
            }
            return false;
        }
        catch (EventStoreException e) when (e.Failure == StoreFailure.Changed)
        {
            // Nothing was saved: no orphan exception is ever written (§2.11).
            await _ui.AlertAsync(EditorStrings.OccurrenceGone);
            Close();
            return false;
        }
        catch (EventStoreException e)
        {
            SaveErrorCode = "EventStore " + e.Failure;
            SaveErrorReason = e.Failure is StoreFailure.ReadOnly or StoreFailure.NotFound ? EditorStrings.SaveFailedReadOnly : EditorStrings.SaveFailedGeneric;
            Announce($"{EditorStrings.SaveFailedTitle}. {SaveErrorReason}");
            return false;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ThirteenException or InvalidOperationException)
        {
            SaveErrorCode = e.GetType().Name;
            SaveErrorReason = EditorStrings.SaveFailedGeneric;
            Announce($"{EditorStrings.SaveFailedTitle}. {SaveErrorReason}");
            return false;
        }
        finally
        {
            _saving = false;
        }
    }

    /// <summary>
    /// Cancel, Escape, the close button and Alt+F4 (§2.11): an unchanged draft just closes; a changed one asks "Discard
    /// changes?" ("Discard this event?" for a new one). True when the editor closed.
    /// </summary>
    public async Task<bool> RequestCloseAsync()
    {
        if (_closed) return true;
        if (!IsDirty)
        {
            Close();
            return true;
        }
        var answer = await _ui.ChooseAsync(SpanQuestions.Discard(Mode == EditorMode.New));
        if (answer is null || _closed) return _closed;
        Close();
        return true;
    }

    /// <summary>Closes the editor without asking (after a save, a delete, or a discard).</summary>
    public void Close()
    {
        if (_closeRaised) return;
        _closeRaised = true;
        _closed = true;
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Every text the editor shows (labels, values, notices, errors) for the no-dashes check, user text excluded.</summary>
    public IEnumerable<string?> CopyTexts() =>
    [
        Title, PrimaryText, CancelText, SaveHint, DeleteText, TitleLabel, LocationLabel, AllDayLabel, StartsLabel, EndsLabel,
        StartField.Text, StartField.Caption, EndField.Text, EndField.Caption, RepeatLabel, RepeatText, EndRepeatLabel, CalendarLabel,
        AlertLabel, SecondAlertLabel, ShowAsLabel, UrlLabel, NotesLabel, ZoneNote, InviteesFooter, RepeatInstanceOnly, RepeatNotice,
        LaterNotice, ExceptionsNotice, AlertNotice, StartError, EndError, EndRepeatError, UrlError, CalendarError,
        .. AlertOptions.Select(o => o.Label), .. EndRepeatOptions, .. ShowAsOptions,
    ];
}
