using System.Text;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

// The event model of Windows on iCalendar documents (docs/EVENTS.md §3.3, §3.6, §4.4, §4.7, §4.9), task W7: what a
// stored UID group means as core's CalendarEvent and EventDraft, and every change of §4.7 (add, an editor save for this
// event, future events or all events, deletes with their spans, alert-only edits) applied to one UID group of a parsed
// document. A port of the web's apps/web/src/lib/events/icsModel.ts (the same rules on the same .ics module), so both
// local stores write the same text:
// - only the changed field groups are written (DraftMerge.Merge, §4.9 rule 1);
// - an unchanged recurrence keeps its property lines (rule 2); a rule whose only change is its end keeps its text with
//   a new COUNT= or UNTIL= (rule 4); EXDATEs added to those read go after them;
// - a new start time, zone or all-day setting of a series retimes every RECURRENCE-ID, EXDATE and RDATE and the UNTIL
//   of every rule (EventRecurrence.Retime, IcsGroups.WithRetimedUntils); it never re-encodes (rule 4);
// - an edited event keeps its TZID string when its zone did not change ("FLE Standard Time" stays);
// - every user change adds one to SEQUENCE and sets LAST-MODIFIED.
// The functions are pure: they read and write an EditWorkspace; EventWriter applies the result through the store.

/// <summary>What a change needs besides the documents: zones, the device zone, the system, "now" (UTC) and new UIDs.</summary>
/// <param name="Zones">The platform's zone data.</param>
/// <param name="DeviceZone">The device's IANA zone (occurrences are in its wall clock).</param>
/// <param name="System">The 13-month system rules are recognized in.</param>
/// <param name="Now">The time of the change as a UTC wall clock (<c>LAST-MODIFIED</c>, <c>DTSTAMP</c>, <c>CREATED</c>).</param>
/// <param name="NewUid">A new UID (lowercase UUID, §3.2).</param>
public sealed record EditContext(IZoneResolver Zones, string DeviceZone, CalendarSystemId System, LocalDateTime Now, Func<string> NewUid);

/// <summary>The span of an editor save or a delete on a repeating event (§2.11, §4.7).</summary>
public enum EditSpan
{
    /// <summary>"Save for this event only" / "Delete this event only".</summary>
    This,

    /// <summary>"Save for future events" / "Delete all future events" (the whole series on its first occurrence).</summary>
    Future,

    /// <summary>"Save for all events" (repeats set in another app, through <see cref="DraftMerge.ApplyToSeries"/>), or a single event.</summary>
    All,
}

/// <summary>A draft that cannot be saved: the issues of <see cref="Drafts.Validate"/> for the groups that are written.</summary>
public sealed class InvalidDraftException(IReadOnlyList<DraftIssue> issues)
    : Exception("The event can't be saved: " + string.Join(", ", issues.Select(i => i.RawValue())) + ".")
{
    /// <summary>The issues, in <see cref="DraftIssue"/> order.</summary>
    public IReadOnlyList<DraftIssue> Issues { get; } = issues;
}

/// <summary>The outcome of a change.</summary>
/// <param name="CalendarId">The calendar of the event after the change, or null when it was deleted.</param>
/// <param name="Uid">The UID group that holds the edited occurrence afterwards (a split's tail has a new one), or null.</param>
/// <param name="Conflicts">Groups written both here and elsewhere (<c>editor.changedElsewhere</c>).</param>
/// <param name="Touched">Every (calendar, UID) whose group the change wrote, for undo.</param>
public sealed record ChangeResult(string? CalendarId, string? Uid, IReadOnlyList<DraftField> Conflicts, IReadOnlyList<(string CalendarId, string Uid)> Touched);

/// <summary>
/// The documents a change reads and writes, by calendar id: the store's snapshot, with the documents the change has set
/// so far in front of it (the primary calendar's current document when the writer runs inside its queue).
/// </summary>
public sealed class EditWorkspace
{
    private readonly Func<string, CalendarState?> _find;
    private readonly Dictionary<string, IcsCalendar> _documents = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IcsCalendar> _changed = new(StringComparer.Ordinal);

    /// <summary>A workspace over <paramref name="find"/> (the store's calendars), with <paramref name="documents"/> read instead of theirs.</summary>
    public EditWorkspace(Func<string, CalendarState?> find, IReadOnlyDictionary<string, IcsCalendar>? documents = null)
    {
        _find = find ?? throw new ArgumentNullException(nameof(find));
        if (documents is not null)
        {
            foreach (var (id, document) in documents) _documents[id] = document;
        }
    }

    /// <summary>A calendar's record and state, or null.</summary>
    public CalendarState? Meta(string id) => _find(id);

    /// <summary>A calendar's current document in this workspace, or null (missing or unreadable).</summary>
    public IcsCalendar? Calendar(string id) =>
        _changed.TryGetValue(id, out var changed) ? changed : _documents.TryGetValue(id, out var document) ? document : _find(id)?.Document;

    /// <summary>Sets a calendar's document.</summary>
    public void Set(string id, IcsCalendar calendar) => _changed[id] = calendar ?? throw new ArgumentNullException(nameof(calendar));

    /// <summary>The documents the change set, by calendar id.</summary>
    public IReadOnlyDictionary<string, IcsCalendar> Changed => _changed;
}

/// <summary>
/// The zones a document's values use: an IANA id, the IANA id a Windows id maps to, <c>UTC</c>, or a zone only the
/// document's own <c>VTIMEZONE</c> defines (named by its <c>TZID</c>). One resolver answers for all of them, so
/// <see cref="ZoneMath"/> converts between any two.
/// </summary>
public sealed class DocumentZones
{
    private readonly Dictionary<string, IZoneResolver> _own = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string?> _handles = new(StringComparer.Ordinal);

    /// <summary>The zones of <paramref name="calendar"/> over the platform's <paramref name="zones"/>.</summary>
    public DocumentZones(IcsCalendar calendar, IZoneResolver zones)
    {
        Calendar = calendar ?? throw new ArgumentNullException(nameof(calendar));
        Platform = zones ?? throw new ArgumentNullException(nameof(zones));
        Resolver = new Combined(this);
    }

    /// <summary>The document.</summary>
    public IcsCalendar Calendar { get; }

    /// <summary>The platform's zone data.</summary>
    public IZoneResolver Platform { get; }

    /// <summary>A resolver for every zone this document names (platform ids and its own <c>VTIMEZONE</c>s).</summary>
    public IZoneResolver Resolver { get; }

    private sealed class Combined(DocumentZones owner) : IZoneResolver
    {
        public bool IsKnown(string tzid) => owner._own.ContainsKey(tzid) || SafeKnown(owner.Platform, tzid);

        public int OffsetMinutesAt(string tzid, LocalDateTime utc) =>
            (owner._own.TryGetValue(tzid, out var own) ? own : owner.Platform).OffsetMinutesAt(tzid, utc);
    }

    private static bool SafeKnown(IZoneResolver zones, string name)
    {
        try
        {
            return zones.IsKnown(name);
        }
        catch (Exception e) when (e is ArgumentException or TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return false;
        }
    }

    /// <summary>The zone of a <c>TZID</c>: an IANA id, the mapped Windows id, the <c>TZID</c> of a file-defined zone, or null (floating).</summary>
    public string? ZoneOfTzid(string tzid)
    {
        if (_handles.TryGetValue(tzid, out var known)) return known;
        var handle = IcsZones.Resolve(tzid, Calendar, Platform);
        string? zone = null;
        if (handle.Kind is ZoneHandleKind.Iana or ZoneHandleKind.Windows) zone = handle.Zone;
        else if (handle.Kind == ZoneHandleKind.VTimeZone && handle.Resolver is not null)
        {
            zone = handle.Tzid;
            _own[handle.Tzid] = handle.Resolver;
        }
        _handles[tzid] = zone;
        return zone;
    }

    /// <summary>The zone a value is in; null for dates, floating values and unknown <c>TZID</c>s.</summary>
    public string? ZoneOf(IcsDateValue value) => value switch
    {
        IcsDateValue.UtcValue => "UTC",
        IcsDateValue.ZonedValue z => ZoneOfTzid(z.Tzid),
        _ => null,
    };

    /// <summary>The wall clock a value names (a date at 00:00).</summary>
    public static LocalDateTime WallClock(IcsDateValue value) => value switch
    {
        IcsDateValue.DateValue d => new LocalDateTime(d.Date, 0),
        IcsDateValue.FloatingValue f => f.Value,
        IcsDateValue.UtcValue u => u.Value,
        IcsDateValue.ZonedValue z => z.Value,
        _ => throw new ArgumentException("Unknown date value", nameof(value)),
    };

    /// <summary>A value as a wall clock in <paramref name="zone"/> (null: as written). Null when it leaves years 1 to 9999.</summary>
    public LocalDateTime? InZone(IcsDateValue value, string? zone)
    {
        if (value is IcsDateValue.DateValue d) return new LocalDateTime(d.Date, 0);
        var own = ZoneOf(value);
        var wall = WallClock(value);
        if (own is null || zone is null || own == zone) return wall;
        var utc = ZoneMath.ToUtc(wall, own, Resolver);
        return utc is { } u ? ZoneMath.ToZoned(u, zone, Resolver) : null;
    }

    /// <summary>A value as a UTC wall clock; floating values and dates through <paramref name="floatingZone"/> (the device's).</summary>
    public LocalDateTime? ToUtc(IcsDateValue value, string floatingZone)
    {
        if (value is IcsDateValue.UtcValue u) return u.Value;
        return ZoneMath.ToUtc(WallClock(value), ZoneOf(value) ?? floatingZone, Resolver);
    }
}

/// <summary>
/// An occurrence found again in its calendar's current document (§3.2), with the stored components behind it, the
/// event it belongs to and the draft the editor opens on it.
/// </summary>
public sealed class ResolvedEvent
{
    internal ResolvedEvent(
        IcsExpandedEvent occurrence, CalendarEvent @event, EventDraft draft, bool isFirst, IcsCalendar calendar, CalendarState meta,
        IcsGroup group, IcsEvent component, IcsEvent? @override, bool orphan, Recognition? recognition, DocumentZones zones)
    {
        Occurrence = occurrence;
        Event = @event;
        Draft = draft;
        IsFirst = isFirst;
        Calendar = calendar;
        Meta = meta;
        Group = group;
        Component = component;
        Override = @override;
        Orphan = orphan;
        Recognition = recognition;
        Zones = zones;
    }

    /// <summary>The occurrence as expanded now.</summary>
    public IcsExpandedEvent Occurrence { get; }

    /// <summary>The series master or single event (or the orphan itself), times in its own zone.</summary>
    public CalendarEvent Event { get; }

    /// <summary>The draft the editor opens: this occurrence's own times and fields, the series' repeat.</summary>
    public EventDraft Draft { get; }

    /// <summary>The first occurrence of its series, a single event or an orphan: "future events" changes the whole series.</summary>
    public bool IsFirst { get; }

    /// <summary>The document as read.</summary>
    public IcsCalendar Calendar { get; }

    /// <summary>The calendar.</summary>
    public CalendarState Meta { get; }

    /// <summary>The UID group.</summary>
    public IcsGroup Group { get; }

    /// <summary>The component this occurrence shows (the master, or its override).</summary>
    public IcsEvent Component { get; }

    /// <summary>The override component, when the occurrence is one.</summary>
    public IcsEvent? Override { get; }

    /// <summary>An override shown on its own (no master, or a repeated <c>RECURRENCE-ID</c>): edited like a single event, Repeat stays Never.</summary>
    public bool Orphan { get; }

    /// <summary>The repeat as recognized (§4.5), or null for a single event.</summary>
    public Recognition? Recognition { get; }

    /// <summary>The document's zones.</summary>
    public DocumentZones Zones { get; }

    /// <summary>The series' repeat, or null.</summary>
    public EventRecurrence? Recurrence => Recognition?.Recurrence;

    /// <summary>Part of a repeating series (not an orphan).</summary>
    public bool IsRepeating => !Orphan && Recurrence is not null;

    /// <summary>The repeat can be rewritten from a later occurrence (§4.5 <c>editable</c>).</summary>
    public bool RepeatEditable => Recognition?.Editable ?? true;

    /// <summary>The <c>ATTENDEE</c> lines of the component (Windows edits them locally only, §3.5).</summary>
    public int AttendeeCount => EventEditing.AttendeeCountOf(Component);

    /// <summary>The original dates of the series' overrides, in the series' zone.</summary>
    public IReadOnlyList<OriginalDate> OverrideDates => EventEditing.OverrideDates(Zones, Group);
}

/// <summary>The model functions (§4.7) on documents; see the file header.</summary>
public static class EventEditing
{
    private const int Day = 1440;
    private static readonly GregorianDate FirstEditable = new(1583, 1, 1);
    private static readonly LocalDateTime LastEnd = new(new GregorianDate(9999, 12, 31), Day);

    // ---- Calendars ----------------------------------------------------------------------------------------

    /// <summary>A store calendar as core's <see cref="CalendarInfo"/>: local calendars keep every repeat, any number of alerts, Show as and URL.</summary>
    public static CalendarInfo InfoOf(CalendarState calendar)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        var color = calendar.Color is { Length: 7 } c && c[0] == '#' ? c : "#808080";
        return new CalendarInfo(
            calendar.Id,
            calendar.Name,
            color,
            calendar.IsSubscription ? CalendarKinds.Subscription : CalendarKinds.Local,
            calendar.IsSubscription ? "Subscriptions" : "On this computer",
            calendar.IsSubscription ? CalendarAccountKind.Subscribed : CalendarAccountKind.Device,
            calendar.IsWritable,
            ThirteenRepeats.All,
            null,
            !calendar.IsSubscription,
            true,
            false);
    }

    // ---- Small helpers ----------------------------------------------------------------------------------

    private readonly record struct IcsDuration(bool Negative, long Days, long Seconds);

    /// <summary>An RFC 5545 duration (<c>P1D</c>, <c>PT1H30M</c>, <c>-PT15M</c>, <c>P2W</c>), or null.</summary>
    private static IcsDuration? ParseDuration(string text)
    {
        var t = text.Trim().ToUpperInvariant();
        var i = 0;
        var negative = false;
        if (i < t.Length && t[i] is '+' or '-') negative = t[i++] == '-';
        if (i >= t.Length || t[i++] != 'P') return null;
        long days = 0, seconds = 0;
        var inTime = false;
        var any = false;
        while (i < t.Length)
        {
            if (t[i] == 'T')
            {
                if (inTime) return null;
                inTime = true;
                i++;
                if (i >= t.Length) return null;
                continue;
            }
            var startDigits = i;
            while (i < t.Length && char.IsAsciiDigit(t[i])) i++;
            if (i == startDigits || i >= t.Length) return null;
            if (!long.TryParse(t.AsSpan(startDigits, i - startDigits), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var n)) return null;
            var unit = t[i++];
            switch (unit)
            {
                case 'W' when !inTime: days += n * 7; break;
                case 'D' when !inTime: days += n; break;
                case 'H' when inTime: seconds += n * 3600; break;
                case 'M' when inTime: seconds += n * 60; break;
                case 'S' when inTime: seconds += n; break;
                default: return null;
            }
            any = true;
        }
        return any ? new IcsDuration(negative, days, seconds) : null;
    }

    /// <summary><c>PT1H30M</c>, <c>PT0M</c>, <c>P1DT2H</c>.</summary>
    private static string FormatMinutesDuration(long total)
    {
        var days = total / Day;
        var hours = total % Day / 60;
        var minutes = total % 60;
        var text = new StringBuilder("P");
        if (days > 0) text.Append(days.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('D');
        if (hours > 0 || minutes > 0 || days == 0)
        {
            text.Append('T');
            if (hours > 0) text.Append(hours.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('H');
            if (minutes > 0 || hours == 0) text.Append(minutes.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('M');
        }
        return text.ToString();
    }

    /// <summary>iCalendar TEXT escaping (RFC 5545 §3.3.11), for property values written as <see cref="IcsProperty"/>.</summary>
    private static string EscapeText(string text) =>
        text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace(";", "\\;", StringComparison.Ordinal).Replace(",", "\\,", StringComparison.Ordinal)
            .Replace("\r\n", "\\n", StringComparison.Ordinal).Replace("\r", "\\n", StringComparison.Ordinal).Replace("\n", "\\n", StringComparison.Ordinal);

    private static IcsDateValue UtcValue(LocalDateTime value) => new IcsDateValue.UtcValue(value);

    private static GregorianDate ClampDay(GregorianDate date, long delta)
    {
        try
        {
            return date.AddDays(delta);
        }
        catch (ArgumentException)
        {
            return date;
        }
    }

    /// <summary>The last day an all-day end (end-of-day form) covers.</summary>
    private static GregorianDate LastDayOf(LocalDateTime start, LocalDateTime end) =>
        end.Minute == 0 && end.Date > start.Date ? end.Date.AddDays(-1) : end.Date;

    /// <summary>A value in the form of <paramref name="form"/> (a date, floating, UTC, or the same <c>TZID</c>) at a date and minute.</summary>
    private static IcsDateValue ValueLike(IcsDateValue form, GregorianDate date, int minute)
    {
        var value = new LocalDateTime(date, minute);
        return form switch
        {
            IcsDateValue.DateValue => new IcsDateValue.DateValue(date),
            IcsDateValue.FloatingValue => new IcsDateValue.FloatingValue(value),
            IcsDateValue.UtcValue => new IcsDateValue.UtcValue(value),
            IcsDateValue.ZonedValue z => new IcsDateValue.ZonedValue(value, z.Tzid),
            _ => throw new ArgumentException("Unknown date value", nameof(form)),
        };
    }

    private static int StartMinuteOf(IcsEvent e) => e.Start is IcsDateValue.DateValue ? 0 : DocumentZones.WallClock(e.Start).Minute;

    private static bool SameOriginal(GregorianDate aDate, int? aMinute, GregorianDate bDate, int? bMinute) => aDate == bDate && aMinute == bMinute;

    private static IcsEvent Bump(IcsEvent e, EditContext ctx) => e with { Sequence = e.Sequence + 1, LastModified = UtcValue(ctx.Now), Raw = null };

    /// <summary>The date a stored start names in its own zone (a <c>DATE</c>, or the wall clock as written).</summary>
    private static GregorianDate StartDateOf(IcsEvent e) => e.Start is IcsDateValue.DateValue d ? d.Date : DocumentZones.WallClock(e.Start).Date;

    /// <summary>Same kind of start, same <c>TZID</c>, same time of day: an <c>UNTIL</c> written for one means the same last occurrence for the other.</summary>
    private static bool SameStartForm(IcsDateValue a, IcsDateValue b)
    {
        if (a.GetType() != b.GetType()) return false;
        if (a is IcsDateValue.DateValue) return true;
        if (a is IcsDateValue.ZonedValue za && b is IcsDateValue.ZonedValue zb && za.Tzid != zb.Tzid) return false;
        return DocumentZones.WallClock(a).Minute == DocumentZones.WallClock(b).Minute;
    }

    /// <summary>
    /// Whether a 13-month rule has the same <c>RRULE</c> encoding from both starts (§4.9 rule 3): an "every 2 weeks"
    /// rule's <c>BYYEARDAY</c> list follows its fortnight, so a start moved by one week needs the new list.
    /// </summary>
    private static bool SameThirteenEncoding(ThirteenRule rule, GregorianDate from, GregorianDate to)
    {
        if (from == to) return true;
        try
        {
            return rule.Encode(from).RRule.IsEquivalentTo(rule.Encode(to).RRule, ignoreEnd: true);
        }
        catch (ThirteenException)
        {
            return false;
        }
    }

    /// <summary>A repeat with no occurrence left (the head of a "future" change whose only dates are excluded): its group shows nothing.</summary>
    private static bool HasNoOccurrence(EventRecurrence recurrence, GregorianDate start)
    {
        var from = start;
        foreach (var x in recurrence.ExtraDates)
        {
            if (x.Date < from) from = x.Date;
        }
        try
        {
            return recurrence.Expand(start, new ExpansionWindow(from, LastEnd.Date), 1).Occurrences.Count == 0;
        }
        catch (ThirteenException)
        {
            return false;
        }
    }

    // ---- Reading ------------------------------------------------------------------------------------------

    /// <summary>An event's start and end in <paramref name="zone"/> (its own), end-of-day form (§3.1.1), as RFC 5545 reads DTEND and DURATION.</summary>
    public static (bool AllDay, LocalDateTime Start, LocalDateTime End) EventTimes(DocumentZones zones, IcsEvent e, string? zone)
    {
        ArgumentNullException.ThrowIfNull(zones);
        ArgumentNullException.ThrowIfNull(e);
        var allDay = e.Start is IcsDateValue.DateValue;
        var start = zones.InZone(e.Start, zone) ?? DocumentZones.WallClock(e.Start);
        if (allDay)
        {
            long days = 1;
            if (e.End is not null)
            {
                days = Math.Max(1, (long)e.End.DateOf.JulianDayNumber - start.Date.JulianDayNumber);
            }
            else if (e.Duration is not null && ParseDuration(e.Duration) is { Negative: false } d)
            {
                days = Math.Max(1, d.Days + (long)Math.Ceiling(d.Seconds / 86400.0));
            }
            GregorianDate last;
            try
            {
                last = start.Date.AddDays(days - 1);
            }
            catch (ArgumentException)
            {
                last = LastEnd.Date;
            }
            return (true, new LocalDateTime(start.Date, 0), new LocalDateTime(last, Day));
        }
        var end = start;
        if (e.End is not null)
        {
            end = zones.InZone(e.End, zone) ?? LastEnd;
        }
        else if (e.Duration is not null && ParseDuration(e.Duration) is { Negative: false } d)
        {
            try
            {
                var wall = start.AddMinutes(d.Days * Day);
                var exact = d.Seconds / 60;
                if (zone is null || exact == 0) end = wall.AddMinutes(exact);
                else
                {
                    var utc = ZoneMath.ToUtc(wall, zone, zones.Resolver);
                    var moved = utc is { } u ? ZoneMath.ToZoned(u.AddMinutes(exact), zone, zones.Resolver) : null;
                    end = moved ?? wall.AddMinutes(exact);
                }
            }
            catch (ArgumentException)
            {
                end = LastEnd;
            }
        }
        if (end < start) end = start;
        return (false, start, EventTime.NormalizeEnd(start, end));
    }

    private static readonly HashSet<string> AlertActions = new(StringComparer.OrdinalIgnoreCase) { "DISPLAY", "AUDIO" };

    /// <summary>A <c>VALARM</c> as core's <see cref="Alarm"/> (absolute alerts in the device's wall clock); null for alarms that are not alerts.</summary>
    public static Alarm? AlarmOf(IcsAlarm alarm, DocumentZones zones, string deviceZone, long lengthMinutes)
    {
        ArgumentNullException.ThrowIfNull(alarm);
        ArgumentNullException.ThrowIfNull(zones);
        if (!AlertActions.Contains(alarm.Action)) return null;
        switch (alarm.Trigger)
        {
            case IcsTrigger.Relative r:
            {
                var minutes = r.Related == IcsTriggerRelation.End ? r.Minutes + lengthMinutes : r.Minutes;
                return minutes is >= int.MinValue and <= int.MaxValue ? Alarm.Relative((int)minutes) : null;
            }
            case IcsTrigger.Absolute a:
            {
                var utc = zones.ToUtc(a.Value, deviceZone);
                var at = utc is { } u ? ZoneMath.ToZoned(u, deviceZone, zones.Resolver) : null;
                return at is { } local ? Alarm.Absolute(local) : null;
            }
            default:
                return null;
        }
    }

    private static ValueList<Alarm> AlarmsOf(IcsEvent e, DocumentZones zones, string deviceZone, long lengthMinutes) =>
        e.Alarms.Select(a => AlarmOf(a, zones, deviceZone, lengthMinutes)).Where(a => a is not null).Select(a => a!).ToValueList();

    private static readonly Dictionary<string, Availability> BusyStatus = new(StringComparer.OrdinalIgnoreCase)
    {
        ["FREE"] = Availability.Free,
        ["BUSY"] = Availability.Busy,
        ["TENTATIVE"] = Availability.Tentative,
        ["OOF"] = Availability.Unavailable,
        ["WORKINGELSEWHERE"] = Availability.Busy,
    };

    /// <summary><c>TRANSP</c> (<c>OPAQUE</c> busy, <c>TRANSPARENT</c> free) and <c>X-MICROSOFT-CDO-BUSYSTATUS</c> (§3.3).</summary>
    public static Availability AvailabilityOf(IcsEvent e)
    {
        ArgumentNullException.ThrowIfNull(e);
        var busy = e.Extra.FirstOrDefault(p => p.Name == "X-MICROSOFT-CDO-BUSYSTATUS");
        if (busy is not null && BusyStatus.TryGetValue(busy.Value, out var mapped)) return mapped;
        return string.Equals(e.Transp, "TRANSPARENT", StringComparison.OrdinalIgnoreCase) ? Availability.Free : Availability.Busy;
    }

    /// <summary>The event's status.</summary>
    public static EventStatus StatusOf(IcsEvent e) => e.Status?.ToUpperInvariant() switch
    {
        "CANCELLED" or "CANCELED" => EventStatus.Canceled,
        "TENTATIVE" => EventStatus.Tentative,
        _ => EventStatus.Confirmed,
    };

    private static EventOrganizer? OrganizerOf(IcsEvent e)
    {
        var p = e.Extra.FirstOrDefault(x => x.Name == "ORGANIZER");
        if (p is null) return null;
        var cn = p.Params.FirstOrDefault(x => x.Name == "CN").Value;
        if (cn is { Length: >= 2 } && cn[0] == '"' && cn[^1] == '"') cn = cn[1..^1];
        var name = cn ?? (p.Value.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) ? p.Value[7..] : p.Value);
        return new EventOrganizer(name, false);
    }

    /// <summary>The <c>ATTENDEE</c> lines of a component.</summary>
    public static int AttendeeCountOf(IcsEvent e) => e.Extra.Count(p => p.Name == "ATTENDEE");

    /// <summary>The repeat a stored master means (§4.5); null for a single event.</summary>
    public static Recognition? RecognitionOf(IcsCalendar calendar, IcsEvent master, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(master);
        if (master.RRules.Count == 0 && master.Rdates.Count == 0) return null;
        return Recognition.Of(IcsExpansion.RecognitionInputFor(master, calendar, ctx.Zones), ctx.System);
    }

    private static bool IsHistorical(DocumentZones zones, IcsEvent e)
    {
        var start = zones.InZone(e.Start, zones.ZoneOf(e.Start));
        return start is { } s && s.Date < FirstEditable;
    }

    /// <summary>The read-only reason of §3.5 on Windows: subscriptions, unreadable calendars, then events before 1583.</summary>
    private static ReadOnlyReason? ReadOnlyOf(CalendarState meta, DocumentZones zones, IcsEvent e)
    {
        if (meta.IsSubscription) return ReadOnlyReason.Subscribed;
        if (!meta.IsWritable) return ReadOnlyReason.Calendar;
        return IsHistorical(zones, e) ? ReadOnlyReason.Historical : null;
    }

    /// <summary>A master, single event or override as core's <see cref="CalendarEvent"/>: times in its own zone.</summary>
    public static CalendarEvent EventOf(IcsCalendar calendar, CalendarState meta, IcsEvent member, EventRecurrence? recurrence, EditContext ctx, DocumentZones? zones = null)
    {
        ArgumentNullException.ThrowIfNull(meta);
        ArgumentNullException.ThrowIfNull(member);
        zones ??= new DocumentZones(calendar, ctx.Zones);
        var zone = zones.ZoneOf(member.Start);
        var (allDay, start, end) = EventTimes(zones, member, zone);
        return new CalendarEvent
        {
            Id = $"{meta.Id}/{member.Uid}",
            Title = member.Summary,
            Location = member.Location,
            Notes = member.Description,
            Url = member.Url,
            AllDay = allDay,
            Start = start,
            End = end,
            TimeZone = allDay ? null : zone,
            CalendarId = meta.Id,
            Recurrence = recurrence,
            Alarms = AlarmsOf(member, zones, ctx.DeviceZone, end.MinutesSince(start)),
            Availability = AvailabilityOf(member),
            Status = StatusOf(member),
            ReadOnly = ReadOnlyOf(meta, zones, member),
            Organizer = OrganizerOf(member),
            AttendeeCount = AttendeeCountOf(member),
            AlarmsEditable = !meta.IsSubscription && meta.IsWritable,
        };
    }

    // ---- Resolving an occurrence (§3.2) ---------------------------------------------------------------------

    /// <summary>
    /// Finds the occurrence <paramref name="key"/> of UID <paramref name="uid"/> (originally on <paramref name="originalDate"/>)
    /// in a calendar's current document, with its event and the draft the editor opens; null when it no longer resolves.
    /// </summary>
    public static ResolvedEvent? Resolve(IcsCalendar calendar, CalendarState meta, string key, string uid, GregorianDate originalDate, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        ArgumentNullException.ThrowIfNull(meta);
        ArgumentNullException.ThrowIfNull(ctx);
        var groups = calendar.Groups.Where(g => g.Uid == uid).ToValueList();
        if (groups.Count == 0) return null;
        var subset = calendar with { Groups = groups };
        var zones = new DocumentZones(calendar, ctx.Zones);
        // Around the original date, and around where an override moved it.
        var days = new List<GregorianDate> { originalDate };
        foreach (var group in groups)
        {
            foreach (var o in group.Overrides)
            {
                var original = o.RecurrenceId is null ? null : zones.InZone(o.RecurrenceId, null);
                if (original is { } value && value.Date == originalDate) days.Add(o.Start.DateOf);
            }
        }
        foreach (var day in days)
        {
            var window = new DeviceWindow(new LocalDateTime(ClampDay(day, -2), 0), new LocalDateTime(ClampDay(day, 2), Day));
            IcsExpansionResult expanded;
            try
            {
                expanded = IcsExpansion.ExpandCalendar(subset, ctx.DeviceZone, ctx.Zones, window, ctx.System, meta.Id);
            }
            catch (ThirteenException)
            {
                continue;
            }
            var found = expanded.Events.FirstOrDefault(e => e.Key == key);
            if (found is null) continue;
            var groupOf = groups[found.Group];
            var master = groupOf.Master;
            var @override = ReferenceEquals(found.Component, master) || (master is not null && found.Component == master) ? null : found.Component;
            var orphan = found.Orphan;
            var recognition = master is null ? null : RecognitionOf(calendar, master, ctx);
            var owner = master is not null && !orphan ? master : found.Component;
            var ownerIsMaster = master is not null && ReferenceEquals(owner, master);
            var @event = EventOf(calendar, meta, owner, ownerIsMaster ? recognition?.Recurrence : null, ctx, zones);
            EventDraft draft;
            if (@override is not null && !orphan)
            {
                var own = EventOf(calendar, meta, @override, null, ctx, zones);
                draft = own.ToDraft() with { CalendarId = meta.Id, Recurrence = @event.Recurrence };
            }
            else if (@override is not null)
            {
                draft = @event.ToDraft();
            }
            else
            {
                draft = ShiftedDraft(@event, found.OriginalDate, found.OriginalMinute);
            }
            var isFirst = orphan || @event.Recurrence is null || (found.OriginalDate == @event.Start.Date && found.OriginalMinute is null);
            return new ResolvedEvent(found, @event, draft, isFirst, calendar, meta, groupOf, found.Component, @override, orphan, recognition, zones);
        }
        return null;
    }

    /// <summary>Resolves <paramref name="occurrence"/> again in the workspace; throws <see cref="StoreFailure.Changed"/> when it is gone.</summary>
    public static ResolvedEvent ResolveOrThrow(EditWorkspace ws, IcsExpandedEvent occurrence, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(ws);
        ArgumentNullException.ThrowIfNull(occurrence);
        var meta = ws.Meta(occurrence.CalendarId);
        var calendar = ws.Calendar(occurrence.CalendarId);
        var resolved = meta is null || calendar is null ? null : Resolve(calendar, meta, occurrence.Key, occurrence.Uid, occurrence.OriginalDate, ctx);
        return resolved ?? throw new EventStoreException(StoreFailure.Changed, "This event changed in another app. Open it again to edit it.");
    }

    /// <summary>The occurrence of <paramref name="master"/> on <paramref name="date"/> (at <paramref name="minute"/>, or the master's start minute), with the master's length.</summary>
    private static EventDraft ShiftedDraft(CalendarEvent master, GregorianDate date, int? minute)
    {
        var start = new LocalDateTime(date, master.AllDay ? 0 : minute ?? master.Start.Minute);
        var length = master.End.MinutesSince(master.Start);
        LocalDateTime end;
        try
        {
            end = EventTime.NormalizeEnd(start, start.AddMinutes(length));
        }
        catch (ArgumentException)
        {
            end = LastEnd;
        }
        return master.ToDraft() with { Start = start, End = end };
    }

    // ---- Writing fields -------------------------------------------------------------------------------------

    /// <summary>The form of a timed draft's values: the stored <c>TZID</c> when the zone did not change, else the draft's zone, <c>Z</c> for UTC, floating.</summary>
    private static IcsDateValue TimedValueForm(DocumentZones zones, IcsDateValue? stored, string? timeZone)
    {
        var at = new LocalDateTime(new GregorianDate(2000, 1, 1), 0);
        if (timeZone is null) return new IcsDateValue.FloatingValue(at);
        if (stored is not null and not IcsDateValue.DateValue && zones.ZoneOf(stored) == timeZone) return stored;
        if (timeZone is "UTC" or "Etc/UTC") return new IcsDateValue.UtcValue(at);
        // A TZID the document already defines for this zone (Outlook's "FLE Standard Time" after an all-day round trip).
        var defined = zones.Calendar.TimeZones.FirstOrDefault(t => zones.ZoneOfTzid(t.Tzid) == timeZone);
        return new IcsDateValue.ZonedValue(at, defined?.Tzid ?? timeZone);
    }

    /// <summary><c>DTSTART</c>, <c>DTEND</c> and <c>DURATION</c> of a draft (§3.3): all-day as dates (no <c>DTEND</c> on 9999-12-31, §3.1.1), timed with <c>DTEND</c>.</summary>
    private static (IcsDateValue Start, IcsDateValue? End, string? Duration) TimeValues(DocumentZones zones, IcsEvent? stored, EventDraft draft)
    {
        if (draft.AllDay)
        {
            var last = LastDayOf(draft.Start, draft.End);
            var end = IcsGroups.AllDayEnd(draft.Start.Date, last < draft.Start.Date ? draft.Start.Date : last);
            return (new IcsDateValue.DateValue(draft.Start.Date), end.End, end.Duration);
        }
        var form = TimedValueForm(zones, stored?.Start, draft.TimeZone);
        var endWall = draft.End.IsEndOfDay ? new LocalDateTime(ClampDay(draft.End.Date, 1), 0) : draft.End;
        return (ValueLike(form, draft.Start.Date, draft.Start.Minute), ValueLike(form, endWall.Date, endWall.Minute), null);
    }

    /// <summary>The <c>VALARM</c>s for <paramref name="alarms"/>: stored ones that still match are kept as read, non-alert alarms are kept, new ones are <c>ACTION:DISPLAY</c>.</summary>
    private static ValueList<IcsAlarm> AlarmValues(DocumentZones zones, IcsEvent? stored, IReadOnlyList<Alarm> alarms, string title, string deviceZone, long lengthMinutes)
    {
        var remaining = alarms.ToList();
        var output = new List<IcsAlarm>();
        foreach (var alarm in stored?.Alarms ?? ValueList<IcsAlarm>.Empty)
        {
            var mapped = AlarmOf(alarm, zones, deviceZone, lengthMinutes);
            if (mapped is null)
            {
                output.Add(alarm);
                continue;
            }
            var index = remaining.FindIndex(a => a == mapped);
            if (index >= 0)
            {
                output.Add(alarm);
                remaining.RemoveAt(index);
            }
        }
        foreach (var alarm in remaining)
        {
            var description = new IcsProperty("DESCRIPTION", EscapeText(title.Length == 0 ? "Reminder" : title));
            switch (alarm)
            {
                case Alarm.RelativeAlarm r:
                    output.Add(new IcsAlarm("DISPLAY", new IcsTrigger.Relative(r.OffsetMinutes, IcsTriggerRelation.Start), [description]));
                    break;
                case Alarm.AbsoluteAlarm a when ZoneMath.ToUtc(a.At, deviceZone, zones.Resolver) is { } utc:
                    output.Add(new IcsAlarm("DISPLAY", new IcsTrigger.Absolute(UtcValue(utc)), [description]));
                    break;
            }
        }
        return output.ToValueList();
    }

    private static string BusyStatusText(Availability availability) => availability switch
    {
        Availability.Free => "FREE",
        Availability.Tentative => "TENTATIVE",
        Availability.Unavailable => "OOF",
        _ => "BUSY",
    };

    private static IcsEvent WithAvailability(IcsEvent stored, Availability availability)
    {
        var transp = availability == Availability.Free ? "TRANSPARENT" : "OPAQUE";
        var extra = stored.Extra;
        if (stored.Extra.Any(p => p.Name == "X-MICROSOFT-CDO-BUSYSTATUS"))
        {
            extra = stored.Extra.Select(p => p.Name == "X-MICROSOFT-CDO-BUSYSTATUS" ? p with { Value = BusyStatusText(availability) } : p).ToValueList();
        }
        else if (availability is Availability.Tentative or Availability.Unavailable)
        {
            extra = stored.Extra.Append(new IcsProperty("X-MICROSOFT-CDO-BUSYSTATUS", BusyStatusText(availability))).ToValueList();
        }
        return stored with { Transp = transp, Extra = extra };
    }

    /// <summary>
    /// A component with the written field groups of <paramref name="merged"/> (title, location, notes, URL, time, alerts,
    /// show as); <c>SEQUENCE</c> + 1 and <c>LAST-MODIFIED</c> now. Repeat and calendar are the caller's.
    /// </summary>
    private static IcsEvent ApplyFields(DocumentZones zones, IcsEvent member, EventDraft merged, IReadOnlyCollection<DraftField> written, EditContext ctx)
    {
        var next = Bump(member, ctx);
        if (written.Contains(DraftField.Title)) next = next with { Summary = merged.Title };
        if (written.Contains(DraftField.Location)) next = next with { Location = merged.Location };
        if (written.Contains(DraftField.Notes)) next = next with { Description = merged.Notes };
        if (written.Contains(DraftField.Url)) next = next with { Url = merged.Url };
        if (written.Contains(DraftField.Time))
        {
            var (start, end, duration) = TimeValues(zones, member, merged);
            next = next with { Start = start, End = end, Duration = duration };
        }
        if (written.Contains(DraftField.Alarms))
        {
            var length = Math.Max(0, merged.End.MinutesSince(merged.Start));
            next = next with { Alarms = AlarmValues(zones, member, merged.Alarms, merged.Title, ctx.DeviceZone, length) };
        }
        if (written.Contains(DraftField.Availability)) next = WithAvailability(next, merged.Availability);
        return next;
    }

    /// <summary>A new component for a draft (a new event, the tail of a split, a new override); <paramref name="baseEvent"/> gives the properties Thirteen does not edit.</summary>
    private static IcsEvent NewComponent(DocumentZones zones, string uid, EventDraft draft, EditContext ctx, IcsEvent? baseEvent)
    {
        var length = Math.Max(0, draft.End.MinutesSince(draft.Start));
        var (start, end, duration) = TimeValues(zones, baseEvent, draft);
        var blank = new IcsEvent
        {
            Uid = uid,
            Summary = draft.Title,
            Location = draft.Location,
            Description = draft.Notes,
            Url = draft.Url,
            Start = start,
            End = end,
            Duration = duration,
            Status = baseEvent?.Status,
            Alarms = AlarmValues(zones, baseEvent, draft.Alarms, draft.Title, ctx.DeviceZone, length),
            Created = UtcValue(ctx.Now),
            LastModified = UtcValue(ctx.Now),
            Dtstamp = UtcValue(ctx.Now),
            Extra = baseEvent?.Extra ?? ValueList<IcsProperty>.Empty,
        };
        return WithAvailability(blank, draft.Availability);
    }

    // ---- Writing recurrence -----------------------------------------------------------------------------------

    private readonly record struct StoredExcept(IcsDateValue Value, OriginalDate? Original);

    private readonly record struct StoredExtra(IcsRdate Rdate, OriginalDate? Extra);

    /// <summary>The stored <c>EXDATE</c>s with the original dates they mean (minute null: the series' time or a DATE value).</summary>
    private static List<StoredExcept> StoredExcepts(DocumentZones zones, IcsEvent master)
    {
        var zone = zones.ZoneOf(master.Start);
        var allDay = master.Start is IcsDateValue.DateValue;
        var startMinute = StartMinuteOf(master);
        return master.Exdates.Select(value =>
        {
            var local = zones.InZone(value, zone);
            if (local is not { } l) return new StoredExcept(value, null);
            int? minute = allDay || value is IcsDateValue.DateValue || l.Minute == startMinute ? null : l.Minute;
            return new StoredExcept(value, new OriginalDate(l.Date, minute));
        }).ToList();
    }

    /// <summary>The stored <c>RDATE</c>s with the extra dates they mean.</summary>
    private static List<StoredExtra> StoredExtras(DocumentZones zones, IcsEvent master)
    {
        var zone = zones.ZoneOf(master.Start);
        var allDay = master.Start is IcsDateValue.DateValue;
        var startMinute = StartMinuteOf(master);
        return master.Rdates.Select(rdate =>
        {
            var local = zones.InZone(rdate.Value, zone);
            if (local is not { } l) return new StoredExtra(rdate, null);
            int? minute = allDay || rdate.Value is IcsDateValue.DateValue || l.Minute == startMinute ? null : l.Minute;
            return new StoredExtra(rdate, new OriginalDate(l.Date, minute));
        }).ToList();
    }

    private static IcsDateValue ExceptValue(IcsEvent master, OriginalDate x) => ValueLike(master.Start, x.Date, x.Minute ?? StartMinuteOf(master));

    private static IcsRdate ExtraValue(IcsEvent master, ExtraDate x, string? period = null)
    {
        IcsDateValue value = master.Start is IcsDateValue.DateValue
            ? new IcsDateValue.DateValue(x.Date)
            : ValueLike(master.Start, x.Date, x.Minute ?? StartMinuteOf(master));
        return new IcsRdate(value, period ?? (x.DurationMinutes is { } d ? FormatMinutesDuration(d) : null));
    }

    /// <summary><c>EXDATE</c> values for the except dates, reusing stored values (their form) where they mean the same date.</summary>
    private static List<IcsDateValue> ExdateValues(IcsEvent master, IReadOnlyList<StoredExcept> stored, IReadOnlyList<OriginalDate> list)
    {
        var pool = stored.ToList();
        return list.Select(x =>
        {
            var index = pool.FindIndex(s => s.Original is { } o && SameOriginal(o.Date, o.Minute, x.Date, x.Minute));
            if (index < 0) return ExceptValue(master, x);
            var value = pool[index].Value;
            pool.RemoveAt(index);
            return value;
        }).ToList();
    }

    private static List<IcsRdate> RdateValues(IcsEvent master, IReadOnlyList<StoredExtra> stored, IReadOnlyList<ExtraDate> list)
    {
        var pool = stored.ToList();
        return list.Select(x =>
        {
            var index = pool.FindIndex(s => s.Extra is { } e && SameOriginal(e.Date, e.Minute, x.Date, x.Minute));
            if (index < 0) return ExtraValue(master, x);
            var value = pool[index].Rdate;
            pool.RemoveAt(index);
            return value;
        }).ToList();
    }

    /// <summary>A repeat's end as <c>COUNT</c> / <c>UNTIL</c> of a rule of <paramref name="master"/> (<c>UNTIL</c> the end of the day in the event's zone, §4.4).</summary>
    private static RRule WithEnd(RRule rule, RepeatEnd end, IcsEvent master, IcsCalendar calendar, IZoneResolver zones) => end switch
    {
        RepeatEnd.CountEnd c => rule with { Until = null, Count = c.Count },
        RepeatEnd.UntilEnd u => rule with { Count = null, Until = IcsGroups.UntilFor(u.Date, master, calendar, zones) },
        _ => rule with { Count = null, Until = null },
    };

    /// <summary>The <c>RRULE</c> of an <c>rrule</c> or <c>thirteen</c> repeat (§4.3, §4.4), its <c>UNTIL</c> in the event's form.</summary>
    private static RRule SingleRule(EventRecurrence recurrence, IcsEvent master, IcsCalendar calendar, IZoneResolver zones, GregorianDate startDate)
    {
        var rule = recurrence.ToRRule(startDate) ?? throw new InvalidOperationException("The repeat has no RRULE form");
        if (rule.Until is RRuleUntil.DateUntil d) rule = rule with { Until = IcsGroups.UntilFor(d.Date, master, calendar, zones) };
        return rule;
    }

    /// <summary>
    /// Writes a recurrence onto <paramref name="master"/> (whose start is already the new one). <paramref name="stored"/>
    /// is the component as read and <paramref name="old"/> its recognized recurrence (null for a single event). The
    /// rule's text is kept when the rule is unchanged (only its end patched), <c>RDATE</c>s and <c>EXDATE</c>s are kept
    /// where they still mean the same dates, and <c>EXDATE</c>s added after the stored ones are appended (§4.9).
    /// </summary>
    private static IcsEvent WithRecurrence(IcsCalendar calendar, DocumentZones zones, IcsEvent master, IcsEvent stored, EventRecurrence? old, EventRecurrence? next, GregorianDate startDate)
    {
        if (next is null)
        {
            return master with
            {
                RRules = ValueList<RRule>.Empty,
                ExRules = ValueList<RRule>.Empty,
                Rdates = ValueList<IcsRdate>.Empty,
                Exdates = ValueList<IcsDateValue>.Empty,
                ThirteenRule = null,
            };
        }
        var platform = zones.Platform;
        IReadOnlyList<RRule> rrules = stored.RRules;
        IReadOnlyList<RRule> exrules = stored.ExRules;
        var thirteenRule = stored.ThirteenRule;
        var extras = StoredExtras(zones, stored);
        var rdatesAreExtras = old is not null
            && extras.Select(s => s.Extra).SequenceEqual(old.ExtraDates.Select(x => (OriginalDate?)new OriginalDate(x.Date, x.Minute)));
        // A 13-month rule keeps its text only while its encoding is the same from the new start (§4.9 rule 3).
        var ruleKept = old is not null && Equals(old.Rule, next.Rule)
            && (next.Rule is not RepeatRule.ThirteenRepeat kept || SameThirteenEncoding(kept.Rule, StartDateOf(stored), startDate));
        if (ruleKept)
        {
            // A new end, or an UNTIL that was written for another time, zone or all-day setting (the tail of a split at a
            // new time: §4.7 "UNTIL is retimed too"; an all-day tail gets a DATE UNTIL).
            var endChanged = !Equals(old!.End, next.End);
            var untilMoved = next.End is RepeatEnd.UntilEnd && !SameStartForm(master.Start, stored.Start);
            if ((endChanged || untilMoved) && next.Rule is RepeatRule.RRuleRepeat or RepeatRule.ThirteenRepeat)
            {
                var fresh = SingleRule(next, master, calendar, platform, startDate);
                rrules = stored.RRules.Count == 1 ? [stored.RRules[0] with { Count = fresh.Count, Until = fresh.Until }] : [fresh];
            }
        }
        else if (old is { Rule: RepeatRule.ForeignRepeat oldForeign } && next.Rule is RepeatRule.ForeignRepeat nextForeign
                 && nextForeign.Rules.Count == stored.RRules.Count && nextForeign.Exrules.Count == stored.ExRules.Count)
        {
            // A foreign rule whose rules only got new ends (the head of a split).
            rrules = stored.RRules.Select((r, i) => Equals(i < oldForeign.Rules.Count ? oldForeign.Rules[i].End : null, nextForeign.Rules[i].End)
                ? r : WithEnd(r, nextForeign.Rules[i].End, master, calendar, platform)).ToList();
            exrules = stored.ExRules.Select((r, i) => Equals(i < oldForeign.Exrules.Count ? oldForeign.Exrules[i].End : null, nextForeign.Exrules[i].End)
                ? r : WithEnd(r, nextForeign.Exrules[i].End, master, calendar, platform)).ToList();
        }
        else
        {
            switch (next.Rule)
            {
                case RepeatRule.RRuleRepeat:
                    rrules = [SingleRule(next, master, calendar, platform, startDate)];
                    exrules = [];
                    thirteenRule = null;
                    break;
                case RepeatRule.ThirteenRepeat thirteen:
                    rrules = [SingleRule(next, master, calendar, platform, startDate)];
                    exrules = [];
                    thirteenRule = thirteen.Rule.ToMarkerText();
                    break;
                case RepeatRule.ForeignRepeat foreign:
                    rrules = foreign.Rules.Select(r => WithEnd(r.RRule, r.End, master, calendar, platform)).ToList();
                    exrules = foreign.Exrules.Select(r => WithEnd(r.RRule, r.End, master, calendar, platform)).ToList();
                    thirteenRule = null;
                    break;
                case RepeatRule.DatesRepeat:
                    rrules = [];
                    exrules = [];
                    thirteenRule = null;
                    break;
            }
        }
        // Extra dates: kept as read while they still mean the same dates.
        IReadOnlyList<IcsRdate> rdates = stored.Rdates;
        var extrasSame = old is not null && old.ExtraDates.Equals(next.ExtraDates);
        if (!(extrasSame && (rdatesAreExtras || ruleKept))) rdates = RdateValues(master, rdatesAreExtras ? extras : [], next.ExtraDates);
        // Excluded dates: kept as read, then the ones added after them.
        var excepts = StoredExcepts(zones, stored);
        List<IcsDateValue> exdates;
        var prefix = excepts.Count <= next.ExceptDates.Count
            && excepts.Select((s, i) => s.Original is { } o && SameOriginal(o.Date, o.Minute, next.ExceptDates[i].Date, next.ExceptDates[i].Minute)).All(x => x);
        if (prefix) exdates = [.. stored.Exdates, .. next.ExceptDates.Skip(excepts.Count).Select(x => ExceptValue(master, x))];
        else exdates = ExdateValues(master, excepts, next.ExceptDates);
        return master with
        {
            RRules = rrules.ToValueList(),
            ExRules = exrules.ToValueList(),
            Rdates = rdates.ToValueList(),
            Exdates = exdates.ToValueList(),
            ThirteenRule = thirteenRule,
        };
    }

    /// <summary>An override's original occurrence in the series' zone (minute null: the series' time).</summary>
    private static OriginalDate? OriginalOf(DocumentZones zones, IcsEvent master, IcsEvent @override)
    {
        if (@override.RecurrenceId is null) return null;
        var local = zones.InZone(@override.RecurrenceId, zones.ZoneOf(master.Start));
        if (local is not { } l) return null;
        var allDay = master.Start is IcsDateValue.DateValue;
        int? minute = allDay || @override.RecurrenceId is IcsDateValue.DateValue || l.Minute == StartMinuteOf(master) ? null : l.Minute;
        return new OriginalDate(l.Date, minute);
    }

    /// <summary>The original dates of a group's overrides (its <c>RECURRENCE-ID</c>s in the series' zone); empty without a master.</summary>
    public static IReadOnlyList<OriginalDate> OverrideDates(DocumentZones zones, IcsGroup group)
    {
        ArgumentNullException.ThrowIfNull(zones);
        ArgumentNullException.ThrowIfNull(group);
        if (group.Master is null) return [];
        return group.Overrides.Select(o => OriginalOf(zones, group.Master, o)).Where(o => o is not null).Select(o => o!.Value).ToList();
    }

    private readonly record struct RetimeOptions(long MinuteDelta, AllDayChange? AllDay);

    private static OriginalDate? RetimeExtra(OriginalDate extra, RetimeOptions options)
    {
        if (options.AllDay == AllDayChange.ToAllDay) return new OriginalDate(extra.Date, null);
        if (options.AllDay is null && extra.Minute is { } minute)
        {
            var total = minute + options.MinuteDelta;
            var days = (long)Math.Floor(total / (double)Day);
            try
            {
                return new OriginalDate(extra.Date.AddDays(days), (int)(total - days * Day));
            }
            catch (ArgumentException)
            {
                return null;
            }
        }
        return extra;
    }

    /// <summary>
    /// Retimes a stored master's exceptions for a new start time, date, zone or all-day setting (§4.7 "Retiming"):
    /// <c>EXDATE</c>s, <c>RDATE</c>s (their <c>PERIOD</c> text kept), the <c>UNTIL</c> of every stored rule (only its
    /// <c>UNTIL=</c> part, unless the repeat itself changed) and the overrides' <c>RECURRENCE-ID</c>s.
    /// </summary>
    private static (IcsEvent Master, List<IcsEvent?> Overrides) Retimed(
        IcsCalendar calendar, DocumentZones zones, IcsEvent stored, IcsEvent master, EventRecurrence old, EventRecurrence next,
        IReadOnlyList<IcsEvent> overrides, LocalDateTime oldStart, LocalDateTime newStart, RetimeOptions options, bool repeatChanged)
    {
        var originals = overrides.Select(o => OriginalOf(zones, stored, o)).ToList();
        var result = old.Retime(originals.Where(o => o is not null).Select(o => o!.Value).ToList(), oldStart.Date, newStart.Date, next, options.MinuteDelta, options.AllDay);
        IcsEvent output;
        var exdates = result.Recurrence.ExceptDates.Select(x => ExceptValue(master, x)).ToValueList();
        // A 13-month rule whose encoding depends on the start (the fortnight of "every 2 weeks") is written anew (§4.9 rule 3).
        var reencode = next.Rule is RepeatRule.ThirteenRepeat thirteen && !SameThirteenEncoding(thirteen.Rule, oldStart.Date, newStart.Date);
        if (repeatChanged || reencode)
        {
            output = WithRecurrence(calendar, zones, master, stored, old, result.Recurrence, newStart.Date);
            output = output with { Exdates = exdates, Rdates = result.Recurrence.ExtraDates.Select(x => ExtraValue(master, x)).ToValueList() };
        }
        else
        {
            output = IcsGroups.WithRetimedUntils(master with { RRules = stored.RRules, ExRules = stored.ExRules }, result.Untils, calendar, zones.Platform);
            // RDATEs keep their PERIOD text; each is found again by the value the retime gave it.
            var remaining = result.Recurrence.ExtraDates.ToList();
            var rdates = new List<IcsRdate>();
            foreach (var (rdate, extra) in StoredExtras(zones, stored))
            {
                if (extra is not { } e) continue;
                var candidate = RetimeExtra(e, options);
                var index = candidate is { } c ? remaining.FindIndex(x => SameOriginal(x.Date, x.Minute, c.Date, c.Minute)) : -1;
                if (index < 0) continue;
                var x = remaining[index];
                remaining.RemoveAt(index);
                rdates.Add(ExtraValue(master, x, options.AllDay == AllDayChange.ToAllDay ? null : rdate.Period));
            }
            rdates.AddRange(remaining.Select(x => ExtraValue(master, x)));
            output = output with { ThirteenRule = stored.ThirteenRule, Exdates = exdates, Rdates = rdates.ToValueList() };
        }
        // Overrides follow their originals (null: dropped by the retime), in their order.
        var startMinute = StartMinuteOf(output);
        var moved = overrides.Select((o, i) =>
        {
            if (originals[i] is not { } from) return null;
            var entry = result.Overrides.FirstOrDefault(m => SameOriginal(m.From.Date, m.From.Minute, from.Date, from.Minute));
            if (entry.To is not { } to || entry.From != from) return (IcsEvent?)null;
            return o with { RecurrenceId = ValueLike(output.Start, to.Date, to.Minute ?? startMinute), Raw = null };
        }).ToList();
        return (output, moved);
    }

    // ---- Previews (what the editor and the span dialog say before anything is written, §2.11) --------------------

    /// <summary>
    /// How many changed or removed occurrences a "future events" save from this later occurrence would drop
    /// (<c>span.future.exceptionsDropped</c>), or 0. <paramref name="original"/> is the draft the editor opened with.
    /// </summary>
    public static int FutureDropped(ResolvedEvent resolved, EventDraft original, EventDraft draft)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        if (resolved.IsFirst || resolved.Recurrence is not { } old) return 0;
        var ruleChanged = !Equals(original.Recurrence, draft.Recurrence);
        if (!ruleChanged && !resolved.RepeatEditable) return 0;
        try
        {
            var split = old.Split(resolved.Event.Start.Date, resolved.Occurrence.OriginalDate, resolved.OverrideDates,
                new SplitChange(draft.Recurrence, draft.Start.Date, ruleChanged));
            return split.DroppedCount;
        }
        catch (ThirteenException)
        {
            return 0;
        }
    }

    /// <summary>
    /// How many changed or removed occurrences a new start time, date or all-day setting of the whole series would drop
    /// (<c>editor.notice.exceptionsRemoved</c> and the span dialog's losses line on the first occurrence), or 0.
    /// </summary>
    public static int RetimeDropped(ResolvedEvent resolved, EventDraft draft)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        ArgumentNullException.ThrowIfNull(draft);
        if (!resolved.IsFirst || resolved.Orphan || resolved.Recurrence is not { } old || draft.Recurrence is not { } next) return 0;
        var current = resolved.Event;
        var startChanged = current.Start != draft.Start || current.AllDay != draft.AllDay || current.TimeZone != draft.TimeZone;
        if (!startChanged && Equals(old, next)) return 0;
        AllDayChange? allDay = current.AllDay == draft.AllDay ? null : draft.AllDay ? AllDayChange.ToAllDay : AllDayChange.ToTimed;
        long minuteDelta = !startChanged || draft.AllDay || current.AllDay ? 0 : draft.Start.Minute - current.Start.Minute;
        try
        {
            return old.Retime(resolved.OverrideDates, current.Start.Date, draft.Start.Date, next, startChanged ? minuteDelta : 0, startChanged ? allDay : null).DroppedCount;
        }
        catch (ThirteenException)
        {
            return 0;
        }
    }

    /// <summary>
    /// What ending the repeat at this occurrence would delete (§2.11 "Later events deleted"): the number of later
    /// occurrences, or null for a series that never ends.
    /// </summary>
    public static long? LaterCount(ResolvedEvent resolved)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        if (resolved.Recurrence is not { } recurrence) return 0;
        try
        {
            return recurrence.LaterCount(resolved.Event.Start.Date, resolved.Occurrence.OriginalDate);
        }
        catch (ThirteenException)
        {
            return 0;
        }
    }

    // ---- Changes (§4.7) -------------------------------------------------------------------------------------

    /// <summary>The issues of the groups that are written: an untouched imported URL never blocks a title change.</summary>
    public static IReadOnlyList<DraftIssue> IssuesFor(EventDraft draft, CalendarInfo info, IReadOnlyCollection<DraftField>? written)
    {
        var all = Drafts.Validate(draft, info);
        if (written is null) return all;
        return all.Where(issue => issue switch
        {
            DraftIssue.InvalidUrl => written.Contains(DraftField.Url),
            DraftIssue.EndBeforeStart or DraftIssue.OutOfRange => written.Contains(DraftField.Time),
            DraftIssue.TooManyAlarms => written.Contains(DraftField.Alarms),
            DraftIssue.CalendarReadOnly => true,
            _ => written.Contains(DraftField.Recurrence) || written.Contains(DraftField.Time),
        }).ToList();
    }

    private static void AssertValid(EventDraft draft, CalendarInfo info, IReadOnlyCollection<DraftField>? written)
    {
        var issues = IssuesFor(draft, info, written);
        if (issues.Count > 0) throw new InvalidDraftException(issues);
    }

    private static (CalendarState Meta, IcsCalendar Calendar) WritableCalendar(EditWorkspace ws, string id)
    {
        var meta = ws.Meta(id) ?? throw new EventStoreException(StoreFailure.NotFound, "This calendar no longer exists.");
        if (meta.IsSubscription || !meta.IsWritable) throw new EventStoreException(StoreFailure.ReadOnly, $"{meta.Name} can't be changed.");
        var calendar = ws.Calendar(id) ?? throw new EventStoreException(StoreFailure.ReadOnly, $"{meta.Name} couldn't be read.");
        return (meta, calendar);
    }

    /// <summary>
    /// Puts a group into a calendar, bringing the <c>VTIMEZONE</c>s it uses from <paramref name="from"/> (§3.6). A zone
    /// only <paramref name="from"/>'s own <c>VTIMEZONE</c> defines, which the target defines differently under the same
    /// <c>TZID</c> (two Outlook "Customized Time Zone"s), is renamed <c>{TZID} (2)</c> as on import, and the group's
    /// values follow it: the event keeps its time. <paramref name="keepRaw"/> keeps the members' stored text (undo).
    /// </summary>
    public static IcsCalendar PutGroup(IcsCalendar target, IcsGroup group, IcsCalendar from, IZoneResolver zones, bool keepRaw = false)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(group);
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(zones);
        if (ReferenceEquals(from, target)) return IcsGroups.ReplaceGroup(target, group, keepRaw);
        var incoming = IcsGroups.RenameCollidingTimeZones(target, @from with { Groups = new[] { group }.ToValueList() }, zones);
        return IcsGroups.ReplaceGroup(IcsGroups.MergeTimeZones(target, incoming), incoming.Groups[0], keepRaw);
    }

    /// <summary>A group under another UID (every member, master and overrides).</summary>
    private static IcsGroup WithUid(IcsGroup group, string uid)
    {
        IcsEvent Rename(IcsEvent member) => member with { Uid = uid, UidDerived = false, Raw = null };
        return new IcsGroup(uid, group.Master is null ? null : Rename(group.Master), group.Overrides.Select(Rename).ToValueList());
    }

    /// <summary>
    /// Writes a group into its calendar, or moves it to another one (calendar changed); returns the UID it is stored
    /// under. A move into a calendar that already holds that UID (the same file imported into both, §3.2) takes a new
    /// UID, so the other calendar's event is never replaced (§3.6).
    /// </summary>
    private static string PlaceGroup(EditWorkspace ws, string sourceId, IcsCalendar source, string targetId, IcsGroup group, EditContext ctx)
    {
        if (targetId == sourceId)
        {
            ws.Set(sourceId, IcsGroups.ReplaceGroup(source, group));
            return group.Uid;
        }
        ws.Set(sourceId, IcsGroups.RemoveGroup(source, group.Uid));
        var (_, target) = WritableCalendar(ws, targetId);
        var moved = target.Groups.Any(g => g.Uid == group.Uid) ? WithUid(group, ctx.NewUid()) : group;
        ws.Set(targetId, PutGroup(target, moved, source, ctx.Zones));
        return moved.Uid;
    }

    private static List<(string CalendarId, string Uid)> TouchedBy(string sourceId, string sourceUid, string targetId, string targetUid) =>
        targetId == sourceId && targetUid == sourceUid ? [(sourceId, sourceUid)] : [(sourceId, sourceUid), (targetId, targetUid)];

    /// <summary>Adds a new event (§2.11): a new UID group with a new lowercase UUID.</summary>
    public static ChangeResult Create(EditWorkspace ws, EventDraft draft, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(ws);
        ArgumentNullException.ThrowIfNull(draft);
        var (meta, calendar) = WritableCalendar(ws, draft.CalendarId);
        AssertValid(draft, InfoOf(meta), null);
        var zones = new DocumentZones(calendar, ctx.Zones);
        var uid = ctx.NewUid();
        var master = NewComponent(zones, uid, draft, ctx, null);
        master = WithRecurrence(calendar, zones, master, master, null, draft.Recurrence, draft.Start.Date);
        ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, new IcsGroup(uid, master, ValueList<IcsEvent>.Empty)));
        return new ChangeResult(meta.Id, uid, [], [(meta.Id, uid)]);
    }

    private static void AssertEditable(ResolvedEvent resolved)
    {
        var meta = resolved.Meta;
        if (meta.IsSubscription || !meta.IsWritable || (resolved.Event.ReadOnly is { } reason && reason != ReadOnlyReason.Historical))
        {
            throw new EventStoreException(StoreFailure.ReadOnly, $"{meta.Name} can't be changed.");
        }
    }

    /// <summary>
    /// An editor save (§2.11, §4.7) of the occurrence <paramref name="occurrence"/>: a three-way merge of
    /// <paramref name="original"/> (the draft the editor opened with) and <paramref name="draft"/> (as saved) with what
    /// is stored now, for <paramref name="span"/>.
    /// </summary>
    public static ChangeResult Save(EditWorkspace ws, IcsExpandedEvent occurrence, EventDraft original, EventDraft draft, EditSpan span, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(original);
        ArgumentNullException.ThrowIfNull(draft);
        var resolved = ResolveOrThrow(ws, occurrence, ctx);
        AssertEditable(resolved);
        var meta = resolved.Meta;
        var calendar = resolved.Calendar;
        var group = resolved.Group;
        var zones = resolved.Zones;
        var master = resolved.Event;
        var info = InfoOf(meta);
        if (master.ReadOnly == ReadOnlyReason.Historical) throw new EventStoreException(StoreFailure.ReadOnly, "Events before 1583 can only be deleted or get new alerts.");
        var target = ws.Meta(draft.CalendarId) ?? throw new EventStoreException(StoreFailure.NotFound, "This calendar no longer exists.");
        if (target.IsSubscription || !target.IsWritable) throw new EventStoreException(StoreFailure.ReadOnly, $"{target.Name} can't be changed.");

        // An override shown on its own: edited like a single event; Repeat stays Never.
        if (resolved.Orphan)
        {
            var component = resolved.Component;
            var current = EventOf(calendar, meta, component, null, ctx, zones).ToDraft();
            var m = DraftMerge.Merge(original, draft, current);
            var own = m.Merged with { CalendarId = meta.Id, Recurrence = null };
            var ownWritten = m.Written.Where(f => f is not DraftField.Recurrence and not DraftField.Calendar).ToList();
            AssertValid(own, info, ownWritten);
            var next = ApplyFields(zones, component, own, m.Written, ctx);
            var overrides = group.Overrides.Select(o => ReferenceEquals(o, component) ? next : o).ToValueList();
            ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, group with { Overrides = overrides }));
            return new ChangeResult(meta.Id, group.Uid, m.Conflicts, [(meta.Id, group.Uid)]);
        }

        var stored = group.Master!;
        var recurring = master.Recurrence is not null;
        if (!recurring) span = EditSpan.All;

        // This occurrence only: add or replace its override (RECURRENCE-ID in the DTSTART form, SEQUENCE + 1).
        if (span == EditSpan.This)
        {
            var existing = resolved.Override;
            var m = DraftMerge.Merge(original, draft, resolved.Draft);
            var own = m.Merged with { CalendarId = meta.Id, Recurrence = null };
            var ownWritten = m.Written.Where(f => f is not DraftField.Recurrence and not DraftField.Calendar).ToList();
            AssertValid(own, info, ownWritten);
            IcsEvent @override;
            if (existing is not null)
            {
                @override = ApplyFields(zones, existing, own, ownWritten, ctx);
            }
            else
            {
                var o = resolved.Occurrence;
                var recurrenceId = ValueLike(stored.Start, o.OriginalDate, o.OriginalMinute ?? StartMinuteOf(stored));
                @override = NewComponent(zones, group.Uid, own, ctx, stored) with { RecurrenceId = recurrenceId, Sequence = stored.Sequence + 1 };
            }
            var overrides = existing is null
                ? group.Overrides.Append(@override).ToValueList()
                : group.Overrides.Select(x => ReferenceEquals(x, existing) ? @override : x).ToValueList();
            ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, new IcsGroup(group.Uid, stored, overrides)));
            return new ChangeResult(meta.Id, group.Uid, m.Conflicts, [(meta.Id, group.Uid)]);
        }

        var old = resolved.Recurrence;

        // Future events from a later occurrence: split (§4.7).
        if (span == EditSpan.Future && !resolved.IsFirst && old is not null)
        {
            var ruleChanged = DraftMerge.ChangedFields(original, draft).Contains(DraftField.Recurrence);
            var originals = group.Overrides.Select(o => OriginalOf(zones, stored, o)).ToList();
            var occ = resolved.Occurrence;
            var split = old.Split(master.Start.Date, occ.OriginalDate, originals.Where(o => o is not null).Select(o => o!.Value).ToList(),
                new SplitChange(draft.Recurrence, draft.Start.Date, ruleChanged));
            var m = DraftMerge.Merge(original, draft, resolved.Draft);
            var tailDraft = m.Merged with { Recurrence = split.Tail };
            var targetMeta = ws.Meta(m.Merged.CalendarId) ?? throw new EventStoreException(StoreFailure.NotFound, "This calendar no longer exists.");
            AssertValid(tailDraft, InfoOf(targetMeta), m.Written);
            // Head: the stored master ends before the occurrence; overrides on or after it leave with it.
            var bumped = Bump(stored, ctx);
            var head = WithRecurrence(calendar, zones, bumped, stored, old, split.Head, master.Start.Date);
            var kept = group.Overrides.Where((_, i) => originals[i] is { } o && o.Date < occ.OriginalDate).ToValueList();
            // A head with no occurrence left (every earlier date deleted alone) goes with its group.
            var headEmpty = kept.Count == 0 && (split.Head is null || HasNoOccurrence(split.Head, master.Start.Date));
            var source = headEmpty ? IcsGroups.RemoveGroup(calendar, group.Uid) : IcsGroups.ReplaceGroup(calendar, new IcsGroup(group.Uid, head, kept));
            // Tail: a new UID from the occurrence, with the carried exceptions.
            var tailUid = ctx.NewUid();
            var tail = NewComponent(zones, tailUid, tailDraft, ctx, stored);
            if (split.Tail is not null)
            {
                // A kept rule keeps its stored text (WKST and part order included), with the tail's end.
                var keepText = !ruleChanged && stored.RRules.Count == 1 && old.Rule is RepeatRule.RRuleRepeat or RepeatRule.ThirteenRepeat;
                var template = keepText ? stored with { Rdates = ValueList<IcsRdate>.Empty, Exdates = ValueList<IcsDateValue>.Empty } : tail;
                tail = WithRecurrence(calendar, zones, tail, template,
                    keepText ? old with { ExtraDates = ValueList<ExtraDate>.Empty, ExceptDates = ValueList<OriginalDate>.Empty } : null,
                    split.Tail, m.Merged.Start.Date);
                if (split.Tail.Rule is RepeatRule.ThirteenRepeat thirteen) tail = tail with { ThirteenRule = thirteen.Rule.ToMarkerText() };
            }
            var tailStartMinute = StartMinuteOf(tail);
            var carried = new List<IcsEvent>();
            if (split.Tail is not null)
            {
                for (var i = 0; i < group.Overrides.Count; i++)
                {
                    if (originals[i] is not { } from) continue;
                    var entry = split.Overrides.FirstOrDefault(x => x.From == from);
                    if (entry.From != from || entry.To is not { } to) continue;
                    carried.Add(group.Overrides[i] with { Uid = tailUid, RecurrenceId = ValueLike(tail.Start, to.Date, to.Minute ?? tailStartMinute), Raw = null, Line = null });
                }
            }
            var tailGroup = new IcsGroup(tailUid, tail, carried.ToValueList());
            if (m.Merged.CalendarId == meta.Id)
            {
                ws.Set(meta.Id, IcsGroups.ReplaceGroup(source, tailGroup));
            }
            else
            {
                ws.Set(meta.Id, source);
                var (_, other) = WritableCalendar(ws, m.Merged.CalendarId);
                ws.Set(m.Merged.CalendarId, PutGroup(other, tailGroup, calendar, ctx.Zones));
            }
            return new ChangeResult(m.Merged.CalendarId, tailUid, m.Conflicts, [(meta.Id, group.Uid), (m.Merged.CalendarId, tailUid)]);
        }

        // The whole series from its first occurrence, or a single event. A first occurrence that was changed on its own
        // (an override at DTSTART) is the occurrence the user edited: it goes through ApplyToSeries below.
        if (!recurring || (resolved.IsFirst && resolved.Override is null))
        {
            var current = master.ToDraft();
            var m = DraftMerge.Merge(original, draft, current);
            var targetMeta = ws.Meta(m.Merged.CalendarId) ?? throw new EventStoreException(StoreFailure.NotFound, "This calendar no longer exists.");
            AssertValid(m.Merged, InfoOf(targetMeta), m.Written);
            var next = ApplyFields(zones, stored, m.Merged, m.Written, ctx);
            var overrides = group.Overrides.ToList();
            // A new start time, date, zone or all-day setting retimes; a new end alone does not (§4.7).
            var startChanged = m.Written.Contains(DraftField.Time)
                && (current.Start != m.Merged.Start || current.AllDay != m.Merged.AllDay || current.TimeZone != m.Merged.TimeZone);
            var repeatChanged = m.Written.Contains(DraftField.Recurrence);
            if (old is not null && m.Merged.Recurrence is not null && (startChanged || repeatChanged))
            {
                AllDayChange? allDay = current.AllDay == m.Merged.AllDay ? null : m.Merged.AllDay ? AllDayChange.ToAllDay : AllDayChange.ToTimed;
                long minuteDelta = !startChanged || m.Merged.AllDay || current.AllDay ? 0 : m.Merged.Start.Minute - current.Start.Minute;
                var options = startChanged ? new RetimeOptions(minuteDelta, allDay) : new RetimeOptions(0, null);
                var output = Retimed(calendar, zones, stored, next, old, m.Merged.Recurrence, group.Overrides, current.Start, m.Merged.Start, options, repeatChanged);
                next = output.Master;
                overrides = output.Overrides.Where(o => o is not null).Select(o => o!).ToList();
            }
            else if (m.Merged.Recurrence is null)
            {
                next = WithRecurrence(calendar, zones, next, stored, old, null, m.Merged.Start.Date);
                overrides = [];
            }
            else if (old is null)
            {
                next = WithRecurrence(calendar, zones, next, stored, null, m.Merged.Recurrence, m.Merged.Start.Date);
            }
            var uid = PlaceGroup(ws, meta.Id, calendar, m.Merged.CalendarId, new IcsGroup(group.Uid, next, overrides.ToValueList()), ctx);
            return new ChangeResult(m.Merged.CalendarId, uid, m.Conflicts, TouchedBy(meta.Id, group.Uid, m.Merged.CalendarId, uid));
        }

        // All events from a later occurrence (repeats set in another app, §2.11), and the whole series from a first
        // occurrence that was changed on its own: the changes made on the opened occurrence go to the master and to that
        // occurrence (ApplyToSeries, §4.7).
        {
            var existing = resolved.Override;
            var first = resolved.IsFirst;
            var opened = existing is null ? null : first ? resolved.Draft : EventOf(calendar, meta, existing, null, ctx, zones).ToDraft();
            var applied = DraftMerge.ApplyToSeries(master.ToDraft(), original, draft, opened);
            var series = applied.Master;
            // From the first occurrence a new date moves the series with it, as it does without the override.
            var dayShift = first && applied.Retime is not null ? draft.Start.Date.DaysSince(original.Start.Date) : 0;
            if (dayShift != 0)
            {
                try
                {
                    series = series with
                    {
                        Start = new LocalDateTime(series.Start.Date.AddDays(dayShift), series.Start.Minute),
                        End = new LocalDateTime(series.End.Date.AddDays(dayShift), series.End.Minute),
                    };
                }
                catch (ArgumentException)
                {
                    throw new InvalidDraftException([DraftIssue.OutOfRange]);
                }
            }
            var targetMeta = ws.Meta(series.CalendarId) ?? throw new EventStoreException(StoreFailure.NotFound, "This calendar no longer exists.");
            var targetInfo = InfoOf(targetMeta);
            AssertValid(series, targetInfo, applied.Written);
            // Conflicts are those of the opened occurrence: what was changed here and, since it opened, elsewhere.
            var conflicts = first ? DraftMerge.Merge(original, draft, resolved.Draft).Conflicts : ValueList<DraftField>.Empty;
            var next = ApplyFields(zones, stored, series, applied.Written, ctx);
            var overrides = group.Overrides.ToList();
            var edited = existing;
            var repeatChanged = first && applied.Written.Contains(DraftField.Recurrence);
            if (first && series.Recurrence is null)
            {
                // Repeat Never from the first occurrence: the event becomes what the opened occurrence shows.
                var single = DraftMerge.Merge(original, draft, resolved.Draft).Merged with { Recurrence = null };
                var differs = DraftMerge.ChangedFields(master.ToDraft(), single).Where(f => f is not DraftField.Recurrence and not DraftField.Calendar).ToList();
                AssertValid(single, targetInfo, differs);
                next = ApplyFields(zones, stored, single, differs, ctx);
                next = WithRecurrence(calendar, zones, next, stored, old, null, single.Start.Date);
                var singleUid = PlaceGroup(ws, meta.Id, calendar, single.CalendarId, new IcsGroup(group.Uid, next, ValueList<IcsEvent>.Empty), ctx);
                return new ChangeResult(single.CalendarId, singleUid, conflicts, TouchedBy(meta.Id, group.Uid, single.CalendarId, singleUid));
            }
            if ((applied.Retime is not null || repeatChanged) && old is not null)
            {
                var options = applied.Retime is { } retime ? new RetimeOptions(retime.MinuteDelta, retime.AllDay) : new RetimeOptions(0, null);
                var output = Retimed(calendar, zones, stored, next, old, series.Recurrence ?? old, group.Overrides, master.Start, series.Start, options, repeatChanged);
                next = output.Master;
                // The edited override follows its original too.
                var index = existing is null ? -1 : group.Overrides.ToList().FindIndex(o => ReferenceEquals(o, existing));
                edited = index < 0 ? null : output.Overrides[index];
                overrides = output.Overrides.Where(o => o is not null).Select(o => o!).ToList();
            }
            if (edited is not null && applied.Override is not null)
            {
                var ownWritten = applied.Written.Where(f => f is not DraftField.Recurrence and not DraftField.Calendar).ToList();
                var changed = ApplyFields(zones, edited, applied.Override with { Recurrence = null }, ownWritten, ctx);
                overrides = overrides.Select(o => ReferenceEquals(o, edited) ? changed : o).ToList();
            }
            var uid = PlaceGroup(ws, meta.Id, calendar, series.CalendarId, new IcsGroup(group.Uid, next, overrides.ToValueList()), ctx);
            return new ChangeResult(series.CalendarId, uid, conflicts, TouchedBy(meta.Id, group.Uid, series.CalendarId, uid));
        }
    }

    /// <summary>"Delete this event", "this event only", "all future events" (§4.7). Historical events stay deletable (§3.5).</summary>
    public static ChangeResult Delete(EditWorkspace ws, IcsExpandedEvent occurrence, EditSpan span, EditContext ctx)
    {
        var resolved = ResolveOrThrow(ws, occurrence, ctx);
        AssertEditable(resolved);
        var meta = resolved.Meta;
        var calendar = resolved.Calendar;
        var group = resolved.Group;
        var zones = resolved.Zones;
        var master = resolved.Event;
        var touched = new List<(string, string)> { (meta.Id, group.Uid) };
        // An override shown on its own: that component goes (and the group once empty).
        if (resolved.Orphan)
        {
            var overrides = group.Overrides.Where(o => !ReferenceEquals(o, resolved.Component)).ToValueList();
            ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, group with { Overrides = overrides }));
            return new ChangeResult(group.Master is null && overrides.Count == 0 ? null : meta.Id, group.Uid, [], touched);
        }
        var stored = group.Master!;
        var old = resolved.Recurrence;
        var whole = old is null || span == EditSpan.All || (span == EditSpan.Future && resolved.IsFirst);
        if (whole)
        {
            ws.Set(meta.Id, IcsGroups.RemoveGroup(calendar, group.Uid));
            return new ChangeResult(null, null, [], touched);
        }
        var bumped = Bump(stored, ctx);
        var occ = resolved.Occurrence;
        if (span == EditSpan.This)
        {
            // EXDATE at the occurrence (at an extra date's own time when it has one); its override goes.
            var value = ValueLike(stored.Start, occ.OriginalDate, occ.OriginalMinute ?? StartMinuteOf(stored));
            var overrides = group.Overrides.Where(o => !ReferenceEquals(o, resolved.Override)).ToValueList();
            ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, new IcsGroup(group.Uid, bumped with { Exdates = stored.Exdates.Append(value).ToValueList() }, overrides)));
            return new ChangeResult(meta.Id, group.Uid, [], touched);
        }
        var head = old!.EndBefore(master.Start.Date, occ.OriginalDate);
        var keptOverrides = group.Overrides.Where(o => OriginalOf(zones, stored, o) is { } original && original.Date < occ.OriginalDate).ToValueList();
        // Nothing left before the occurrence (its earlier dates were all deleted alone): the whole group goes, never a
        // series whose only dates are excluded (it could not be opened, and would still be exported and counted).
        if (head is null || (keptOverrides.Count == 0 && HasNoOccurrence(head, master.Start.Date)))
        {
            ws.Set(meta.Id, IcsGroups.RemoveGroup(calendar, group.Uid));
            return new ChangeResult(null, null, [], touched);
        }
        var next = WithRecurrence(calendar, zones, bumped, stored, old, head, master.Start.Date);
        ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, new IcsGroup(group.Uid, next, keptOverrides)));
        return new ChangeResult(meta.Id, group.Uid, [], touched);
    }

    // ---- Undo by field group (§2.11) -----------------------------------------------------------------------

    private static string MemberKeyOf(IcsEvent e) => e.RecurrenceId is null ? "master" : "rid:" + e.RecurrenceId;

    private static Dictionary<string, IcsEvent>? MembersByKey(IcsGroup group)
    {
        var map = new Dictionary<string, IcsEvent>(StringComparer.Ordinal);
        foreach (var member in group.Members)
        {
            if (!map.TryAdd(MemberKeyOf(member), member)) return null;
        }
        return map;
    }

    private static bool SameText(IcsEvent a, IcsEvent b) =>
        string.Equals(a.Raw ?? a.Original ?? a.ToString(), b.Raw ?? b.Original ?? b.ToString(), StringComparison.Ordinal);

    private static bool SameRecurrenceLines(IcsEvent a, IcsEvent b) =>
        a.RRules.Equals(b.RRules) && a.ExRules.Equals(b.ExRules) && a.Rdates.Equals(b.Rdates) && a.Exdates.Equals(b.Exdates) && a.ThirteenRule == b.ThirteenRule;

    /// <summary>
    /// Undo (or redo) of a written change by field group (§2.11 "Undo of a written change reverts only the field groups
    /// that change touched, through mergeDraft"): member by member, <paramref name="current"/> (the group as stored now)
    /// takes the groups in which <paramref name="target"/> (the version to go back to) differs from
    /// <paramref name="written"/> (the version the change wrote); every other group stays as stored now, so a note another
    /// app added since is kept. A member the change added goes again, one it removed comes back. Null
    /// (<c>calendar.undoUnavailable</c>) when another app changed one of those groups since, or removed or added a
    /// member the change touched.
    /// </summary>
    public static IcsGroup? RevertFields(IcsCalendar document, CalendarState meta, IcsGroup written, IcsGroup target, IcsGroup current, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(meta);
        ArgumentNullException.ThrowIfNull(written);
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(ctx);
        var w = MembersByKey(written);
        var t = MembersByKey(target);
        var c = MembersByKey(current);
        if (w is null || t is null || c is null) return null;
        if (w.Keys.Any(k => !c.ContainsKey(k))) return null;                     // removed elsewhere since
        var zones = new DocumentZones(document, ctx.Zones);
        EventDraft DraftOf(IcsEvent member) => EventOf(document, meta, member, null, ctx, zones).ToDraft();
        IcsEvent? Revert(IcsEvent wm, IcsEvent tm, IcsEvent cm)
        {
            if (SameText(wm, tm)) return cm;                                          // untouched by the change
            var recurrenceTouched = !SameRecurrenceLines(wm, tm);
            if (recurrenceTouched && !SameRecurrenceLines(cm, wm)) return null;
            try
            {
                var wd = DraftOf(wm);
                var td = DraftOf(tm);
                var cd = DraftOf(cm);
                var touched = DraftMerge.ChangedFields(wd, td);
                var elsewhere = DraftMerge.ChangedFields(wd, cd);
                if (touched.Any(elsewhere.Contains)) return null;
                if (touched.Count == 0 && !recurrenceTouched) return cm;
                var next = Bump(cm, ctx);
                if (touched.Contains(DraftField.Title)) next = next with { Summary = tm.Summary };
                if (touched.Contains(DraftField.Location)) next = next with { Location = tm.Location };
                if (touched.Contains(DraftField.Notes)) next = next with { Description = tm.Description };
                if (touched.Contains(DraftField.Url)) next = next with { Url = tm.Url };
                if (touched.Contains(DraftField.Time)) next = next with { Start = tm.Start, End = tm.End, Duration = tm.Duration };
                if (touched.Contains(DraftField.Alarms)) next = next with { Alarms = tm.Alarms };
                if (touched.Contains(DraftField.Availability)) next = WithAvailability(next, td.Availability);
                if (recurrenceTouched)
                {
                    next = next with { RRules = tm.RRules, ExRules = tm.ExRules, Rdates = tm.Rdates, Exdates = tm.Exdates, ThirteenRule = tm.ThirteenRule };
                }
                return next;
            }
            catch (ThirteenException)
            {
                return null;
            }
        }
        var members = new List<IcsEvent>();
        foreach (var cm in current.Members)
        {
            var key = MemberKeyOf(cm);
            if (w.TryGetValue(key, out var wm))
            {
                if (t.TryGetValue(key, out var tm))
                {
                    if (Revert(wm, tm, cm) is not { } reverted) return null;
                    members.Add(reverted);
                }
                else if (!SameText(wm, cm))
                {
                    return null;                                                      // added by the change, changed since
                }
            }
            else
            {
                if (t.ContainsKey(key)) return null;                                  // the change removed it; another is there now
                members.Add(cm);
            }
        }
        members.AddRange(target.Members.Where(m => !w.ContainsKey(MemberKeyOf(m))));
        var master = members.FirstOrDefault(m => m.RecurrenceId is null);
        return new IcsGroup(current.Uid, master, members.Where(m => m.RecurrenceId is not null).ToValueList());
    }

    /// <summary>Changes only the alerts (§3.5): of the master and every override of the series, or of the one component shown on its own.</summary>
    public static ChangeResult SetAlarms(EditWorkspace ws, IcsExpandedEvent occurrence, IReadOnlyList<Alarm> alarms, EditContext ctx)
    {
        ArgumentNullException.ThrowIfNull(alarms);
        var resolved = ResolveOrThrow(ws, occurrence, ctx);
        var meta = resolved.Meta;
        var calendar = resolved.Calendar;
        var group = resolved.Group;
        var zones = resolved.Zones;
        if (!resolved.Event.AlarmsEditable) throw new EventStoreException(StoreFailure.ReadOnly, "The alerts of this event cannot be changed.");
        var wanted = alarms.ToValueList();
        IcsEvent Change(IcsEvent member)
        {
            var own = EventOf(calendar, meta, member, null, ctx, zones);
            if (own.Alarms.Equals(wanted)) return member;
            return ApplyFields(zones, member, own.ToDraft() with { Alarms = wanted }, [DraftField.Alarms], ctx);
        }
        var updated = resolved.Orphan
            ? group with { Overrides = group.Overrides.Select(o => ReferenceEquals(o, resolved.Component) ? Change(o) : o).ToValueList() }
            : new IcsGroup(group.Uid, group.Master is null ? null : Change(group.Master), group.Overrides.Select(Change).ToValueList());
        ws.Set(meta.Id, IcsGroups.ReplaceGroup(calendar, updated));
        return new ChangeResult(meta.Id, group.Uid, [], [(meta.Id, group.Uid)]);
    }
}
