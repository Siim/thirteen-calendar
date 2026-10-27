using Avalonia.Media;
using Avalonia.Media.Immutable;
using CommunityToolkit.Mvvm.Input;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>A labelled line of the details ("Time", "Repeat", ...).</summary>
/// <param name="Label">The label (<c>event.*</c>).</param>
/// <param name="Value">The value (user text for location, URL and notes); several alerts are one per line.</param>
/// <param name="Kind">How the value behaves: plain, a location (opens Maps), a link (opens the browser) or notes (selectable).</param>
public sealed record DetailLine(string Label, string Value, DetailLineKind Kind = DetailLineKind.Plain)
{
    /// <summary>A second line under the value: the time-zone line of Time (<c>event.zoneLine</c>), or null.</summary>
    public string? Note { get; init; }

    /// <summary>The calendar's color dot before the value (the Calendar line), or null.</summary>
    public IBrush? Dot { get; init; }

    /// <summary>The value opens Maps or the browser.</summary>
    public bool IsLink => Kind is DetailLineKind.Location or DetailLineKind.Url;

    /// <summary>The value is plain or notes (and has no dot).</summary>
    public bool IsText => !IsLink && Dot is null;

    /// <summary>The value follows a color dot.</summary>
    public bool HasDot => Dot is not null;

    /// <summary>Whether <see cref="Note"/> shows.</summary>
    public bool HasNote => Note is not null;

    /// <summary>The line's accessible name: "Location, Raamatukoi, Tartu"; "Time, 21:00 to 22:00, In New York: 15:00 to 16:00".</summary>
    public string AccessibleName => Note is null ? $"{Label}, {Value.Replace("\n", ", ", StringComparison.Ordinal)}" : $"{Label}, {Value}, {Note}";
}

/// <summary>What a details line's value does.</summary>
public enum DetailLineKind
{
    /// <summary>Plain text.</summary>
    Plain,

    /// <summary>A location: opens Windows Maps.</summary>
    Location,

    /// <summary>A URL: opens the browser.</summary>
    Url,

    /// <summary>Notes: selectable text.</summary>
    Notes,
}

/// <summary>
/// An event's details (docs/EVENTS.md §2.10; task W7), the flyout of Windows: the title with the calendar's color bar and
/// its Tentative or Canceled tag, the date plate (13-month date over the Gregorian one, Starts and Ends for several days),
/// the time and the zone line, the repeat in 13-month words, the calendar, the alerts, Show as (when not Busy), location,
/// URL and notes, the read-only notice, and the actions: Edit, More (Duplicate) and "Delete event" for writable events;
/// "Edit alerts" and "Delete event" next to <c>event.readOnly.historical.local</c> for events before 1583; Duplicate only
/// for subscribed events.
/// </summary>
public sealed class EventDetailsViewModel : ViewModelBase
{
    private readonly IEventsUi? _ui;

    /// <summary>The details of <paramref name="item"/>, from its resolved event when it still resolves (<paramref name="resolved"/>).</summary>
    public EventDetailsViewModel(CalendarItem item, ResolvedEvent? resolved, CalendarSystemId system, string deviceZone, bool use24Hour, IEventsUi? ui = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        Item = item;
        _ui = ui;
        var source = item.Source;
        var calendar = resolved?.Meta;
        EventTitle = item.Title;
        ColorBrush = new ImmutableSolidColorBrush(item.Color);
        Tag = item.Status switch
        {
            EventStatus.Tentative => EditorStrings.Tentative,
            EventStatus.Canceled => EditorStrings.Canceled,
            _ => null,
        };

        // Date plate: the 13-month date over the Gregorian one; Starts and Ends lines for several days.
        var first = item.FirstDay;
        var last = item.LastDay;
        MultiDay = first != last;
        ThirteenDate = EditorStrings.LongDate(first, system);
        GregorianDate = EditorStrings.GregorianLong(first);
        EndThirteenDate = EditorStrings.LongDate(last, system);
        EndGregorianDate = EditorStrings.GregorianLong(last);

        // The lines in the order of §2.10 and board A2: Time (with the zone line under it), Repeat, Calendar, Alerts,
        // then Show as (only when not Busy), Location, URL, Notes.
        var lines = new List<DetailLine>();
        // Time: "09:30 to 10:30" or "All day"; the zone line when the event's zone differs from the device's.
        if (!item.AllDay && resolved?.Draft is { TimeZone: { } zone } own && zone != deviceZone)
        {
            ZoneLine = EditorStrings.ZoneLine(EventEditorViewModel.CityOf(zone), EventStrings.Time(own.Start.Minute), EventStrings.Time(own.End.Minute));
        }
        lines.Add(new DetailLine(EditorStrings.TimeLabel, item.AllDay ? EditorStrings.AllDay : EditorStrings.TimeRange(EventStrings.Time(source.Start.Minute), EventStrings.Time(source.End.Minute)))
        {
            Note = ZoneLine,
        });
        // Repeat: the description from core.
        if (resolved?.Recurrence is { } recurrence && !resolved.Orphan)
        {
            string description;
            try
            {
                description = recurrence.Describe(resolved.Event.Start.Date, system);
            }
            catch (ThirteenException)
            {
                description = EditorStrings.RepeatCustomUnknown;
            }
            lines.Add(new DetailLine(EditorStrings.Repeat, description));
        }
        // Calendar: name, account ("Personal, On this computer"), after its color dot.
        var account = item.ReadOnly == Core.Events.ReadOnlyReason.Subscribed ? EventStrings.GroupSubscriptions : EventStrings.GroupComputer;
        CalendarText = $"{item.CalendarName}, {account}";
        lines.Add(new DetailLine(EditorStrings.Calendar, CalendarText) { Dot = ColorBrush });
        // Alerts: one line per alert.
        var alarms = resolved?.Draft.Alarms ?? ValueList<Alarm>.Empty;
        if (calendar is { IsSubscription: true }) alarms = ValueList<Alarm>.Empty;
        Alerts = alarms.Select(a => a.Describe(item.AllDay, system, use24Hour)).ToList();
        if (Alerts.Count > 0) lines.Add(new DetailLine(EditorStrings.Alerts, string.Join("\n", Alerts)));
        // Show as (only when not Busy), location, URL, notes.
        var availability = resolved?.Draft.Availability ?? Availability.Busy;
        if (availability != Availability.Busy)
        {
            lines.Add(new DetailLine(EditorStrings.ShowAs, availability == Availability.Free ? EditorStrings.Free : availability == Availability.Tentative ? EditorStrings.Tentative : EditorStrings.Busy));
        }
        var location = resolved?.Draft.Location ?? item.Location;
        if (location.Length > 0) lines.Add(new DetailLine(EditorStrings.Location, location, DetailLineKind.Location));
        var url = resolved?.Draft.Url ?? source.Component.Url;
        if (url.Length > 0) lines.Add(new DetailLine(EditorStrings.Url, url, DetailLineKind.Url));
        var notes = resolved?.Draft.Notes ?? source.Component.Description;
        if (notes.Length > 0) lines.Add(new DetailLine(EditorStrings.Notes, notes, DetailLineKind.Notes));
        Lines = lines;

        // Read-only notice and actions (§2.10, §3.5).
        ReadOnlyReason = item.ReadOnly;
        ReadOnlyText = CalendarStrings.ReadOnlyReason(item.ReadOnly);
        CanEdit = item.ReadOnly is null;
        CanEditAlerts = item.ReadOnly == Core.Events.ReadOnlyReason.Historical;
        CanDelete = item.CanDelete;

        EditCommand = new RelayCommand(() => EditRequested?.Invoke(), () => CanEdit);
        EditAlertsCommand = new RelayCommand(() => EditAlertsRequested?.Invoke(), () => CanEditAlerts);
        DeleteCommand = new RelayCommand(() => DeleteRequested?.Invoke(), () => CanDelete);
        DuplicateCommand = new RelayCommand(() => DuplicateRequested?.Invoke());
        OpenLineCommand = new RelayCommand<DetailLine?>(OpenLine);
    }

    /// <summary>The item the details are for.</summary>
    public CalendarItem Item { get; }

    /// <summary>The title (user text).</summary>
    public string EventTitle { get; }

    /// <summary>The calendar's color (the leading bar).</summary>
    public IBrush ColorBrush { get; }

    /// <summary>"Tentative" or "Canceled", or null.</summary>
    public string? Tag { get; }

    /// <summary>Whether the tag shows.</summary>
    public bool HasTag => Tag is not null;

    /// <summary>The event spans several days: Starts and Ends lines.</summary>
    public bool MultiDay { get; }

    /// <summary>A one-day event: one plate line.</summary>
    public bool SingleDay => !MultiDay;

    /// <summary>"Thursday, October 12, 2026" or "Year Day 2026" (the first day).</summary>
    public string ThirteenDate { get; }

    /// <summary>"Monday, October 19, 2026" (Geist Mono).</summary>
    public string GregorianDate { get; }

    /// <summary>The last day, 13-month.</summary>
    public string EndThirteenDate { get; }

    /// <summary>The last day, Gregorian.</summary>
    public string EndGregorianDate { get; }

    /// <summary><c>event.starts</c></summary>
    public string StartsLabel => EditorStrings.Starts;

    /// <summary><c>event.ends</c></summary>
    public string EndsLabel => EditorStrings.Ends;

    /// <summary>The plate's accessible name.</summary>
    public string PlateName => MultiDay
        ? $"{EditorStrings.Starts}, {ThirteenDate}. Gregorian {GregorianDate}. {EditorStrings.Ends}, {EndThirteenDate}. Gregorian {EndGregorianDate}"
        : $"{ThirteenDate}. Gregorian {GregorianDate}";

    /// <summary><c>event.zoneLine</c> ("In New York: 21:00 to 22:00"), or null.</summary>
    public string? ZoneLine { get; }

    /// <summary>Whether the zone line shows.</summary>
    public bool HasZoneLine => ZoneLine is not null;

    /// <summary>The labelled lines in the order of §2.10: time (with the zone line), repeat, calendar, alerts, show as, location, URL, notes.</summary>
    public IReadOnlyList<DetailLine> Lines { get; }

    /// <summary>At 150 % text and above each line's label goes above its value (§2.20), so no label is cut.</summary>
    public bool Stacked { get; init; }

    /// <summary><c>event.calendar</c></summary>
    public string CalendarLabel => EditorStrings.Calendar;

    /// <summary>"Personal, On this computer".</summary>
    public string CalendarText { get; }

    /// <summary><c>event.alerts</c></summary>
    public string AlertsLabel => EditorStrings.Alerts;

    /// <summary>One line per alert.</summary>
    public IReadOnlyList<string> Alerts { get; }

    /// <summary>Whether the alerts show.</summary>
    public bool HasAlerts => Alerts.Count > 0;

    /// <summary>The read-only reason, or null.</summary>
    public ReadOnlyReason? ReadOnlyReason { get; }

    /// <summary>The reason line (<c>event.readOnly.*</c>), or null.</summary>
    public string? ReadOnlyText { get; }

    /// <summary>Whether the read-only notice shows.</summary>
    public bool IsReadOnly => ReadOnlyText is not null;

    /// <summary>Edit shows (writable events).</summary>
    public bool CanEdit { get; }

    /// <summary>"Edit alerts" shows (events before 1583, §2.10).</summary>
    public bool CanEditAlerts { get; }

    /// <summary>"Delete event" shows (writable or historical).</summary>
    public bool CanDelete { get; }

    /// <summary><c>event.edit</c></summary>
    public string EditText => EditorStrings.Edit;

    /// <summary><c>event.editAlerts</c></summary>
    public string EditAlertsText => EditorStrings.EditAlerts;

    /// <summary><c>event.delete</c></summary>
    public string DeleteText => EditorStrings.DeleteEvent;

    /// <summary><c>calendar.menu.duplicate</c></summary>
    public string DuplicateText => EditorStrings.Duplicate;

    /// <summary>The overflow button's name ("More").</summary>
    public string MoreText => EditorStrings.More;

    /// <summary>"More: Duplicate" (the overflow button's tooltip, board A2).</summary>
    public string MoreTip => $"{EditorStrings.More}: {EditorStrings.Duplicate}";

    /// <summary>Edit.</summary>
    public RelayCommand EditCommand { get; }

    /// <summary>Edit alerts.</summary>
    public RelayCommand EditAlertsCommand { get; }

    /// <summary>Delete event.</summary>
    public RelayCommand DeleteCommand { get; }

    /// <summary>Duplicate (the More menu).</summary>
    public RelayCommand DuplicateCommand { get; }

    /// <summary>Opens a location in Maps or a URL in the browser.</summary>
    public RelayCommand<DetailLine?> OpenLineCommand { get; }

    /// <summary>Raised by Edit.</summary>
    public event Action? EditRequested;

    /// <summary>Raised by Edit alerts.</summary>
    public event Action? EditAlertsRequested;

    /// <summary>Raised by Delete event.</summary>
    public event Action? DeleteRequested;

    /// <summary>Raised by Duplicate.</summary>
    public event Action? DuplicateRequested;

    private void OpenLine(DetailLine? line)
    {
        if (line is null || _ui is null) return;
        Uri? uri = line.Kind switch
        {
            DetailLineKind.Location => new Uri("bingmaps:?q=" + Uri.EscapeDataString(line.Value)),
            DetailLineKind.Url when Uri.TryCreate(line.Value.Contains("://", StringComparison.Ordinal) ? line.Value : "https://" + line.Value, UriKind.Absolute, out var u)
                && u.Scheme is "http" or "https" or "mailto" => u,
            _ => null,
        };
        if (uri is not null) _ui.Launch(uri);
    }

    /// <summary>Every text the details show except user text, for the no-dashes check.</summary>
    public IEnumerable<string?> CopyTexts() =>
    [
        Tag, ThirteenDate, GregorianDate, EndThirteenDate, EndGregorianDate, ZoneLine, CalendarLabel, AlertsLabel, ReadOnlyText,
        EditText, EditAlertsText, DeleteText, DuplicateText, MoreText, .. Alerts,
        .. Lines.Select(l => l.Label), .. Lines.Where(l => l.Kind == DetailLineKind.Plain).Select(l => l.Value),
    ];
}
