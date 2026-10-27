using System.Globalization;
using System.Text;

namespace Thirteen.Core.Events;

// The platform-neutral event model (docs/EVENTS.md §3.1, §3.5, §2.11, §2.14, §4.9, §5.2), mirroring
// packages/core/src/events/model.ts: calendars, drafts, stored events and occurrences; draft validation
// and defaults; the editor's start, end and all-day rules; the three-way merge every save uses; and alerts
// (presets, descriptions and fire times). All wall-clock values of a draft are in the draft's TimeZone
// (null = floating, always null for all-day events), and every end is in end-of-day form (§3.1.1).

/// <summary>"Show as". Thirteen offers Busy and Free; the others are kept as read. TS: <c>Availability</c>.</summary>
public enum Availability
{
    /// <summary><c>busy</c>.</summary>
    Busy,
    /// <summary><c>free</c>.</summary>
    Free,
    /// <summary><c>tentative</c>.</summary>
    Tentative,
    /// <summary><c>unavailable</c>.</summary>
    Unavailable,
}

/// <summary>An event's status. TS: <c>EventStatus</c>.</summary>
public enum EventStatus
{
    /// <summary><c>confirmed</c>.</summary>
    Confirmed,
    /// <summary><c>tentative</c>.</summary>
    Tentative,
    /// <summary><c>canceled</c>.</summary>
    Canceled,
}

/// <summary>Why an event cannot be changed in Thirteen (§3.5, first matching reason). TS: <c>ReadOnlyReason</c>.</summary>
public enum ReadOnlyReason
{
    /// <summary><c>calendar</c>.</summary>
    Calendar,
    /// <summary><c>subscribed</c>.</summary>
    Subscribed,
    /// <summary><c>birthday</c>.</summary>
    Birthday,
    /// <summary><c>invitation</c>.</summary>
    Invitation,
    /// <summary><c>no-write-permission</c>.</summary>
    NoWritePermission,
    /// <summary><c>historical</c>.</summary>
    Historical,
}

/// <summary>The kind of account a calendar belongs to (§3.4). TS: <c>CalendarAccountKind</c>.</summary>
public enum CalendarAccountKind
{
    /// <summary><c>icloud</c>.</summary>
    ICloud,
    /// <summary><c>google</c>.</summary>
    Google,
    /// <summary><c>exchange</c>.</summary>
    Exchange,
    /// <summary><c>caldav</c>.</summary>
    CalDav,
    /// <summary><c>device</c>.</summary>
    Device,
    /// <summary><c>subscribed</c>.</summary>
    Subscribed,
    /// <summary><c>birthdays</c>.</summary>
    Birthdays,
    /// <summary><c>other</c>.</summary>
    Other,
}

/// <summary>Whether a calendar keeps 13-month repeats that are not Exchange-safe (§3.5).</summary>
public enum ThirteenRepeats
{
    /// <summary><c>all</c>.</summary>
    All,
    /// <summary><c>gregorian-only</c>: only forms (a) and (c) of §4.3.</summary>
    GregorianOnly,
}

/// <summary>A problem <see cref="Drafts.Validate"/> reports; each is shown under its field (§2.11). TS: <c>DraftIssue</c>.</summary>
public enum DraftIssue
{
    /// <summary><c>end-before-start</c>.</summary>
    EndBeforeStart,
    /// <summary><c>out-of-range</c>.</summary>
    OutOfRange,
    /// <summary><c>until-before-start</c>.</summary>
    UntilBeforeStart,
    /// <summary><c>calendar-read-only</c>.</summary>
    CalendarReadOnly,
    /// <summary><c>thirteen-repeat-not-allowed</c>.</summary>
    ThirteenRepeatNotAllowed,
    /// <summary><c>too-many-alarms</c>.</summary>
    TooManyAlarms,
    /// <summary><c>repeat-not-on-start</c>.</summary>
    RepeatNotOnStart,
    /// <summary><c>invalid-url</c>.</summary>
    InvalidUrl,
    /// <summary><c>count-out-of-range</c>.</summary>
    CountOutOfRange,
}

/// <summary>The field groups of a draft that saves write independently (§2.11, §4.9); <see cref="Time"/> is all-day, start, end and zone. TS: <c>DraftField</c>.</summary>
public enum DraftField
{
    /// <summary><c>title</c>.</summary>
    Title,
    /// <summary><c>location</c>.</summary>
    Location,
    /// <summary><c>notes</c>.</summary>
    Notes,
    /// <summary><c>url</c>.</summary>
    Url,
    /// <summary><c>time</c>.</summary>
    Time,
    /// <summary><c>recurrence</c>.</summary>
    Recurrence,
    /// <summary><c>calendar</c>.</summary>
    Calendar,
    /// <summary><c>alarms</c>.</summary>
    Alarms,
    /// <summary><c>availability</c>.</summary>
    Availability,
}

/// <summary>Text forms of the model enums (the TypeScript and JSON values).</summary>
public static class ModelText
{
    /// <summary><c>busy</c>, <c>free</c>, <c>tentative</c> or <c>unavailable</c>.</summary>
    public static string RawValue(this Availability value) => value switch
    {
        Availability.Busy => "busy",
        Availability.Free => "free",
        Availability.Tentative => "tentative",
        _ => "unavailable",
    };

    /// <summary>The kebab-case value of an issue (<c>end-before-start</c>).</summary>
    public static string RawValue(this DraftIssue issue) => issue switch
    {
        DraftIssue.EndBeforeStart => "end-before-start",
        DraftIssue.OutOfRange => "out-of-range",
        DraftIssue.UntilBeforeStart => "until-before-start",
        DraftIssue.CalendarReadOnly => "calendar-read-only",
        DraftIssue.ThirteenRepeatNotAllowed => "thirteen-repeat-not-allowed",
        DraftIssue.TooManyAlarms => "too-many-alarms",
        DraftIssue.RepeatNotOnStart => "repeat-not-on-start",
        DraftIssue.InvalidUrl => "invalid-url",
        _ => "count-out-of-range",
    };

    /// <summary>The lowercase value of a field (<c>title</c>).</summary>
    public static string RawValue(this DraftField field) => field switch
    {
        DraftField.Title => "title",
        DraftField.Location => "location",
        DraftField.Notes => "notes",
        DraftField.Url => "url",
        DraftField.Time => "time",
        DraftField.Recurrence => "recurrence",
        DraftField.Calendar => "calendar",
        DraftField.Alarms => "alarms",
        _ => "availability",
    };

    /// <summary><c>icloud</c>, <c>google</c>, <c>exchange</c>, <c>caldav</c>, <c>device</c>, <c>subscribed</c>, <c>birthdays</c> or <c>other</c>.</summary>
    public static string RawValue(this CalendarAccountKind kind) => kind switch
    {
        CalendarAccountKind.ICloud => "icloud",
        CalendarAccountKind.Google => "google",
        CalendarAccountKind.Exchange => "exchange",
        CalendarAccountKind.CalDav => "caldav",
        CalendarAccountKind.Device => "device",
        CalendarAccountKind.Subscribed => "subscribed",
        CalendarAccountKind.Birthdays => "birthdays",
        _ => "other",
    };

    /// <summary><c>calendar</c>, <c>subscribed</c>, <c>birthday</c>, <c>invitation</c>, <c>no-write-permission</c> or <c>historical</c>.</summary>
    public static string RawValue(this ReadOnlyReason reason) => reason switch
    {
        ReadOnlyReason.Calendar => "calendar",
        ReadOnlyReason.Subscribed => "subscribed",
        ReadOnlyReason.Birthday => "birthday",
        ReadOnlyReason.Invitation => "invitation",
        ReadOnlyReason.NoWritePermission => "no-write-permission",
        _ => "historical",
    };

    /// <summary><c>confirmed</c>, <c>tentative</c> or <c>canceled</c>.</summary>
    public static string RawValue(this EventStatus status) => status switch
    {
        EventStatus.Confirmed => "confirmed",
        EventStatus.Tentative => "tentative",
        _ => "canceled",
    };

    /// <summary><c>all</c> or <c>gregorian-only</c>.</summary>
    public static string RawValue(this ThirteenRepeats value) => value == ThirteenRepeats.All ? "all" : "gregorian-only";
}

/// <summary>
/// An alert. Relative alerts count from the occurrence's start (for all-day events, from <c>T00:00</c> of
/// its day: "1 day before at 09:00" is -900). Absolute alerts are a device wall clock; they are kept as read
/// and never offered in the pickers. TS: <c>Alarm</c>.
/// </summary>
public abstract record Alarm
{
    private Alarm()
    {
    }

    /// <summary><c>"relative"</c> or <c>"absolute"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>A relative alert; negative is before the start.</summary>
    public static Alarm Relative(int offsetMinutes) => new RelativeAlarm(offsetMinutes);

    /// <summary>An absolute alert at a device wall clock (minute 0..1439).</summary>
    public static Alarm Absolute(LocalDateTime at) => new AbsoluteAlarm(at);

    /// <summary>A relative alert; <see cref="OffsetMinutes"/> negative is before the start.</summary>
    public sealed record RelativeAlarm(int OffsetMinutes) : Alarm
    {
        /// <inheritdoc />
        public override string Kind => "relative";
    }

    /// <summary>An absolute alert at a device wall clock.</summary>
    public sealed record AbsoluteAlarm : Alarm
    {
        /// <summary>Validated: minute 0..1439.</summary>
        public AbsoluteAlarm(LocalDateTime at)
        {
            EventTime.AssertPlain(at, "absolute alarm time");
            At = at;
        }

        /// <summary>The device wall clock.</summary>
        public LocalDateTime At { get; }

        /// <inheritdoc />
        public override string Kind => "absolute";
    }

    /// <summary>09:00, the time of the all-day alert presets.</summary>
    private const int Nine = 9 * 60;

    private static readonly (string Id, int? Offset)[] TimedPresets =
    [
        ("none", null),
        ("at-time", 0),
        ("before-5m", -5),
        ("before-10m", -10),
        ("before-15m", -15),
        ("before-30m", -30),
        ("before-1h", -60),
        ("before-2h", -120),
        ("before-1d", -Ev.Day),
        ("before-2d", -2 * Ev.Day),
        ("before-1w", -7 * Ev.Day),
    ];

    private static readonly (string Id, int? Offset)[] AllDayPresets =
    [
        ("none", null),
        ("day-at-0900", Nine),
        ("before-1d-at-0900", Nine - Ev.Day),
        ("before-2d-at-0900", Nine - 2 * Ev.Day),
        ("before-1w-at-0900", Nine - 7 * Ev.Day),
    ];

    /// <summary>
    /// When an alert fires, as a UTC wall clock (§2.14), for platforms that plan alerts themselves: a relative
    /// alert on a timed occurrence is its start instant (<paramref name="startUtc"/>) plus the offset, exactly;
    /// one on an all-day occurrence is its wall-clock time on its day in the device's zone (a DST gap moves
    /// forward as in <see cref="ZoneMath.ToUtc"/>); an absolute alert is its device wall clock in the device's
    /// zone. Pass the <c>StartUtc</c> of the expanded occurrence. TS: <c>alarmFireTime</c>.
    /// </summary>
    /// <returns>The UTC wall clock, or <c>null</c> when it falls outside years 1 to 9999.</returns>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for an all-day start that is not <c>T00:00</c>, a timed
    /// occurrence without <paramref name="startUtc"/>, or an unknown zone.
    /// </exception>
    public static LocalDateTime? FireTime(Alarm alarm, bool allDay, LocalDateTime start, LocalDateTime? startUtc, string deviceZone, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(alarm);
        EventTime.AssertPlain(start, "occurrence start");
        ZoneMath.AssertKnownZone(deviceZone, zones);
        switch (alarm)
        {
            case AbsoluteAlarm absolute:
                return ZoneMath.ToUtc(absolute.At, deviceZone, zones);
            case RelativeAlarm relative when allDay:
            {
                if (start.Minute != 0) throw Ev.Fail("An all-day occurrence starts at T00:00");
                var wall = LocalDateTime.FromAbsolute(start.Absolute + relative.OffsetMinutes);
                return wall is { } w ? ZoneMath.ToUtc(w, deviceZone, zones) : null;
            }
            case RelativeAlarm relative:
                if (startUtc is not { } utc) throw Ev.Fail("A timed occurrence needs startUtc to place a relative alert");
                return LocalDateTime.FromAbsolute(utc.Absolute + relative.OffsetMinutes);
            default:
                throw new InvalidOperationException();
        }
    }

    /// <summary>When this alert fires for an expanded occurrence; see <see cref="FireTime(Alarm, bool, LocalDateTime, LocalDateTime?, string, IZoneResolver)"/>.</summary>
    public LocalDateTime? FireTime(ExpandedOccurrence occurrence, string deviceZone, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        return FireTime(this, occurrence.AllDay, occurrence.Start, occurrence.StartUtc, deviceZone, zones);
    }

    /// <summary><c>{time}</c> of the copy catalogue: <c>09:00</c>, or <c>9:00 AM</c> in 12-hour form.</summary>
    private static string ClockLabel(int minute, bool use24Hour)
    {
        var hour = minute / 60;
        var minutes = Ev.Pad(minute % 60, 2);
        if (use24Hour) return $"{Ev.Pad(hour, 2)}:{minutes}";
        return $"{(hour % 12 == 0 ? 12 : hour % 12).Inv()}:{minutes} {(hour < 12 ? "AM" : "PM")}";
    }

    private static string Count(long n, string one, string many) => n == 1 ? $"1 {one}" : $"{n.Inv()} {many}";

    /// <summary>The text of a relative alert (copy catalogue <c>alert.*</c>).</summary>
    private static string DescribeRelative(int offset, bool allDay, bool use24Hour)
    {
        if (allDay)
        {
            var days = Ev.FloorDiv(offset, Ev.Day);
            var time = ClockLabel((int)(offset - days * Ev.Day), use24Hour);
            if (days == 0) return $"On the day at {time}";
            if (days == -7) return $"1 week before at {time}";
            if (days < 0) return $"{Count(-days, "day", "days")} before at {time}";
            return $"{Count(offset, "minute", "minutes")} after";
        }
        if (offset == 0) return "At time of event";
        if (offset > 0) return $"{Count(offset, "minute", "minutes")} after";
        var before = -(long)offset;
        if (before == 7 * Ev.Day) return "1 week before";
        if (before % Ev.Day == 0) return $"{Count(before / Ev.Day, "day", "days")} before";
        if (before % 60 == 0) return $"{Count(before / 60, "hour", "hours")} before";
        return $"{Count(before, "minute", "minutes")} before";
    }

    /// <summary>
    /// The rows of the Alert and Second alert pickers (§2.14), in order: timed: None, At time of event, 5, 10,
    /// 15 and 30 minutes, 1 and 2 hours, 1 and 2 days, 1 week before; all-day: None, On the day at 09:00, 1 day,
    /// 2 days and 1 week before at 09:00. <paramref name="allowAfterStart"/> false leaves out "On the day at
    /// 09:00". TS: <c>alarmPresets</c>.
    /// </summary>
    public static IReadOnlyList<AlarmPreset> Presets(bool allDay, bool allowAfterStart = true, bool use24Hour = true) =>
        (allDay ? AllDayPresets : TimedPresets)
            .Where(p => allowAfterStart || p.Offset is null or <= 0)
            .Select(p => p.Offset is { } offset
                ? new AlarmPreset(p.Id, DescribeRelative(offset, allDay, use24Hour), Relative(offset))
                : new AlarmPreset(p.Id, "None", null))
            .ToList();

    /// <summary>
    /// The text of any alert (§2.14, copy catalogue <c>alert.*</c>): the preset labels, and for alerts set
    /// elsewhere <c>45 minutes before</c>, <c>3 hours before</c>, <c>10 minutes after</c>, all-day <c>2 days before
    /// at 18:30</c>, and absolute alerts <c>At 08:00 on Thursday, October 12, 2026</c> (the date in the 13-month
    /// <paramref name="system"/>, long style with weekday). TS: <c>describeAlarm</c>.
    /// </summary>
    public string Describe(bool allDay, CalendarSystemId system = CalendarSystemId.Ifc, bool use24Hour = true)
    {
        _ = system.Definition();
        return this switch
        {
            RelativeAlarm relative => DescribeRelative(relative.OffsetMinutes, allDay, use24Hour),
            AbsoluteAlarm absolute =>
                $"At {ClockLabel(absolute.At.Minute, use24Hour)} on {ThirteenFormat.Format(ThirteenDate.FromGregorian(absolute.At.Date, system), new FormatOptions(DateStyle.Long, IncludeWeekday: true))}",
            _ => throw new InvalidOperationException(),
        };
    }
}

/// <summary>One row of an alert picker (§2.14). TS: <c>AlarmPreset</c>.</summary>
/// <param name="Id">Stable id, e.g. <c>before-15m</c> or <c>before-1d-at-0900</c>.</param>
/// <param name="Label">The row's text, e.g. <c>15 minutes before</c>.</param>
/// <param name="Alarm">Null for None.</param>
public sealed record AlarmPreset(string Id, string Label, Alarm? Alarm);

/// <summary>A calendar as the editor and the views see it (§3.4). TS: <c>CalendarInfo</c>.</summary>
/// <param name="Id">The calendar id.</param>
/// <param name="Title">The title.</param>
/// <param name="Color"><c>#rrggbb</c>, sRGB.</param>
/// <param name="AccountId">Groups the Calendars list.</param>
/// <param name="AccountTitle"><c>iCloud</c>, <c>liis.kask@example.com</c>, <c>On My PC</c>.</param>
/// <param name="AccountKind">The account kind.</param>
/// <param name="Writable">Whether events can be written.</param>
/// <param name="ThirteenRepeats">Whether the calendar keeps 13-month repeats that are not Exchange-safe.</param>
/// <param name="MaxAlarms">Null: no known limit.</param>
/// <param name="SupportsAvailability">Whether Show as is kept.</param>
/// <param name="SupportsUrl">Whether the URL is kept.</param>
/// <param name="IsPlatformDefault">The platform's default calendar.</param>
public sealed record CalendarInfo(
    string Id,
    string Title,
    string Color,
    string AccountId,
    string AccountTitle,
    CalendarAccountKind AccountKind,
    bool Writable,
    ThirteenRepeats ThirteenRepeats,
    int? MaxAlarms,
    bool SupportsAvailability,
    bool SupportsUrl,
    bool IsPlatformDefault)
{
    internal void AssertValid()
    {
        foreach (var (name, value) in new[] { ("id", Id), ("title", Title), ("accountId", AccountId), ("accountTitle", AccountTitle) })
        {
            if (value is null) throw Ev.Fail($"Invalid calendar: {name} must be a string, got null");
        }
        if (Color is null || Color.Length != 7 || Color[0] != '#' || !Color[1..].All(Uri.IsHexDigit))
        {
            throw Ev.Fail($"Invalid calendar: color must be '#rrggbb', got {Ev.Show(Color)}");
        }
        if (MaxAlarms is < 0) throw Ev.Fail($"Invalid calendar: maxAlarms must be a non-negative integer or null, got {MaxAlarms.Value.Inv()}");
    }
}

/// <summary>
/// What the editor edits (§3.1). Wall-clock values are in <see cref="TimeZone"/> (the device zone for new
/// events; null = floating, always null for all-day events). TS: <c>EventDraft</c>.
/// </summary>
public record EventDraft
{
    /// <summary>The title.</summary>
    public string Title { get; init; } = "";

    /// <summary><c>""</c> = none (same for <see cref="Notes"/> and <see cref="Url"/>).</summary>
    public string Location { get; init; } = "";

    /// <summary>The notes.</summary>
    public string Notes { get; init; } = "";

    /// <summary>The URL.</summary>
    public string Url { get; init; } = "";

    /// <summary>All-day: from <c>T00:00</c> of the first day to <c>T24:00</c> of the last.</summary>
    public bool AllDay { get; init; }

    /// <summary>The start (minute 0..1439; all-day: <c>T00:00</c> of the first day).</summary>
    public LocalDateTime Start { get; init; }

    /// <summary>End-of-day form (§3.1.1); all-day: <c>T24:00</c> of the last day.</summary>
    public LocalDateTime End { get; init; }

    /// <summary>IANA id; null = floating; always null for all-day.</summary>
    public string? TimeZone { get; init; }

    /// <summary>The calendar.</summary>
    public string CalendarId { get; init; } = "";

    /// <summary>§4; null = does not repeat.</summary>
    public EventRecurrence? Recurrence { get; init; }

    /// <summary>The alerts.</summary>
    public ValueList<Alarm> Alarms { get; init; } = ValueList<Alarm>.Empty;

    /// <summary>Show as.</summary>
    public Availability Availability { get; init; } = Availability.Busy;

    /// <summary>A fresh draft with only the <see cref="EventDraft"/> fields (a <see cref="CalendarEvent"/> loses its own).</summary>
    public EventDraft ToDraft() => new()
    {
        Title = Title,
        Location = Location,
        Notes = Notes,
        Url = Url,
        AllDay = AllDay,
        Start = Start,
        End = End,
        TimeZone = TimeZone,
        CalendarId = CalendarId,
        Recurrence = Recurrence,
        Alarms = Alarms,
        Availability = Availability,
    };

    /// <summary>
    /// Validates the shape (all-day drafts start at <c>T00:00</c>, end at <c>T24:00</c> or <c>T00:00</c>, and have
    /// no zone; a non-empty zone; a 24:00 start is not allowed). States the user can fix are issues of
    /// <see cref="Drafts.Validate"/>, not shape errors.
    /// </summary>
    internal void AssertValid(string context)
    {
        string? problem = null;
        if (Title is null || Location is null || Notes is null || Url is null || CalendarId is null) problem = "title, location, notes, url and calendarId must be strings";
        else if (Start.Minute == Ev.Day) problem = "start: minute must be an integer 0..1439 (24:00 is only allowed in an end), got 1440";
        else if (Alarms is null) problem = "alarms must be an array";
        else if (TimeZone is not null && TimeZone.Length == 0) problem = "timeZone must be a non-empty string or null, got \"\"";
        else if (AllDay && TimeZone is not null) problem = $"an all-day draft has timeZone null, got {Ev.Show(TimeZone)}";
        else if (AllDay && Start.Minute != 0) problem = "an all-day draft starts at T00:00";
        else if (AllDay && End.Minute != 0 && End.Minute != Ev.Day) problem = "an all-day draft ends at T24:00 (or T00:00) of a day";
        if (problem is not null) throw Ev.Fail($"Invalid {context}: {problem}");
        Recurrence?.AssertValid();
    }
}

/// <summary>An organizer of an invitation.</summary>
public sealed record EventOrganizer(string Name, bool IsCurrentUser);

/// <summary>A stored event as read from the platform (series master or single event). TS: <c>CalendarEvent</c>.</summary>
public sealed record CalendarEvent : EventDraft
{
    /// <summary>§3.2.</summary>
    public string Id { get; init; } = "";

    /// <summary>The status.</summary>
    public EventStatus Status { get; init; } = EventStatus.Confirmed;

    /// <summary>Why it cannot be changed, or null.</summary>
    public ReadOnlyReason? ReadOnly { get; init; }

    /// <summary>The organizer, or null.</summary>
    public EventOrganizer? Organizer { get; init; }

    /// <summary>Attendees.</summary>
    public int AttendeeCount { get; init; }

    /// <summary>§3.5: true for writable events and for invitations whose store keeps per-user alerts.</summary>
    public bool AlarmsEditable { get; init; }

    /// <summary><c>accepted</c>, <c>declined</c>, <c>tentative</c>, <c>needs-action</c> or null.</summary>
    public string? SelfStatus { get; init; }
}

/// <summary>
/// One occurrence as the views lay it out, in the DEVICE's wall clock. Platforms keep richer objects by key.
/// TS: <c>EventOccurrence</c>.
/// </summary>
/// <param name="Key">Unique among the occurrences passed to one call (§3.2).</param>
/// <param name="CalendarId">The calendar.</param>
/// <param name="Title">The title.</param>
/// <param name="AllDay">All-day.</param>
/// <param name="Start">The start.</param>
/// <param name="End">End-of-day form.</param>
public sealed record EventOccurrence(string Key, string CalendarId, string Title, bool AllDay, LocalDateTime Start, LocalDateTime End);

/// <summary>The result of <see cref="Drafts.MoveStart"/>.</summary>
public sealed record MovedDraft(EventDraft Draft, RepeatChange RepeatChange);

/// <summary>The times a draft had before it became all-day (minutes after midnight).</summary>
public readonly record struct PreviousTimes(int Start, int End);

/// <summary>Draft validation, defaults and the editor's start, end and all-day rules (§2.11). TS: model.ts.</summary>
public static class Drafts
{
    /// <summary>1583-01-01T00:00, the earliest start Thirteen creates or edits (§3.1.1).</summary>
    private static readonly long EarliestEditableStart = (long)new GregorianDate(1583, 1, 1).JulianDayNumber * Ev.Day;

    /// <summary>9999-12-29T24:00, the latest timed end Thirteen creates or edits (§3.1.1).</summary>
    private static readonly long LatestEditableTimedEnd = ((long)new GregorianDate(9999, 12, 29).JulianDayNumber + 1) * Ev.Day;

    /// <summary>"After {n} times" allows 1 to 999 on every platform (§2.11).</summary>
    private const int MaxCount = 999;

    /// <summary>09:00.</summary>
    private const int Nine = 9 * 60;

    /// <summary>
    /// Every issue of a draft for the target calendar, in <see cref="DraftIssue"/> order (§5.2); empty means the
    /// draft can be saved: an end before the start; a start before 1583-01-01 or a timed end after
    /// 9999-12-29T24:00; a repeat that ends before the start date; a read-only calendar; a 13-month repeat that
    /// is not Exchange-safe in a gregorian-only calendar; too many alarms; a 13-month repeat that does not
    /// produce the start; an invalid URL; a count outside 1..999. TS: <c>validateDraft</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a malformed draft or calendar; never for an issue.</exception>
    public static IReadOnlyList<DraftIssue> Validate(EventDraft draft, CalendarInfo calendar)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(calendar);
        draft.AssertValid("event draft");
        calendar.AssertValid();
        var issues = new HashSet<DraftIssue>();
        var start = draft.Start.Absolute;
        var end = draft.End.Absolute;
        if (draft.AllDay ? end <= start : end < start) issues.Add(DraftIssue.EndBeforeStart);
        if (start < EarliestEditableStart || (!draft.AllDay && end > LatestEditableTimedEnd)) issues.Add(DraftIssue.OutOfRange);
        if (!calendar.Writable) issues.Add(DraftIssue.CalendarReadOnly);
        if (calendar.MaxAlarms is { } max && draft.Alarms.Count > max) issues.Add(DraftIssue.TooManyAlarms);
        if (draft.Url.Length > 0 && !IsValidEventUrl(draft.Url)) issues.Add(DraftIssue.InvalidUrl);
        if (draft.Recurrence is { } recurrence)
        {
            if (recurrence.End is RepeatEnd.UntilEnd until && until.Date.JulianDayNumber < draft.Start.Date.JulianDayNumber) issues.Add(DraftIssue.UntilBeforeStart);
            if (recurrence.End is RepeatEnd.CountEnd { Count: < 1 or > MaxCount }) issues.Add(DraftIssue.CountOutOfRange);
            if (recurrence.Rule is RepeatRule.ThirteenRepeat thirteen)
            {
                // Exchange keeps forms (a) and (c) only (§4.3); the start is always the first occurrence (§4.2).
                if (calendar.ThirteenRepeats == ThirteenRepeats.GregorianOnly && thirteen.Rule.EncodingForm == ThirteenEncodingForm.ByYearDay)
                {
                    issues.Add(DraftIssue.ThirteenRepeatNotAllowed);
                }
                if (!thirteen.Rule.Includes(draft.Start.Date, draft.Start.Date)) issues.Add(DraftIssue.RepeatNotOnStart);
            }
        }
        return Enum.GetValues<DraftIssue>().Where(issues.Contains).ToList();
    }

    // ---- URL check (§2.11) ---------------------------------------------------------------------

    /// <summary>JavaScript's <c>\s</c> (with the u flag): the characters <c>/[\s\p{Cc}]/u</c> rejects besides controls.</summary>
    private static bool IsJsWhitespace(char c) => c is '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or '\u00a0' or '\u1680'
        or (>= '\u2000' and <= '\u200a') or '\u2028' or '\u2029' or '\u202f' or '\u205f' or '\u3000' or '\ufeff';

    private static bool IsPort(string text) =>
        text.Length is >= 1 and <= 5 && text.All(Ev.IsAsciiDigit) && int.Parse(text, CultureInfo.InvariantCulture) <= 65535;

    /// <summary>A host label: letters, digits, marks, '_' and '-' of any script (by code point), not empty.</summary>
    private static bool IsHostLabel(string label)
    {
        if (label.Length == 0) return false;
        foreach (var rune in label.EnumerateRunes())
        {
            if (rune.Value is '_' or '-') continue;
            switch (Rune.GetUnicodeCategory(rune))
            {
                case UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter
                    or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter
                    or UnicodeCategory.DecimalDigitNumber or UnicodeCategory.LetterNumber or UnicodeCategory.OtherNumber
                    or UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark:
                    continue;
                default:
                    return false;
            }
        }
        return true;
    }

    /// <summary>
    /// The editor's URL rule (§2.11): no whitespace or control characters, and either <c>scheme://</c> with a
    /// non-empty host, or a host with a dot, <c>localhost</c> or a bracketed IPv6 address, with an optional
    /// port (1 to 5 digits up to 65535) and path, query or fragment.
    /// </summary>
    internal static bool IsValidEventUrl(string text)
    {
        if (text.Any(c => IsJsWhitespace(c) || char.GetUnicodeCategory(c) == UnicodeCategory.Control)) return false;
        var schemeLength = SchemeWithAuthorityLength(text);
        var rest = schemeLength < 0 ? text : text[schemeLength..];
        var cut = rest.IndexOfAny(['/', '?', '#']);
        var authority = cut < 0 ? rest : rest[..cut];
        var host = authority[(authority.LastIndexOf('@') + 1)..];
        if (host.StartsWith('['))
        {
            var close = host.IndexOf(']', StringComparison.Ordinal);
            if (close < 2) return false;
            var after = host[(close + 1)..];
            if (after.Length > 0 && !(after.StartsWith(':') && IsPort(after[1..]))) return false;
            return host[1..close].All(c => Uri.IsHexDigit(c) || c is ':' or '.');
        }
        var colon = host.LastIndexOf(':');
        if (colon >= 0)
        {
            if (!IsPort(host[(colon + 1)..])) return false;
            host = host[..colon];
        }
        if (host.Length == 0) return false;
        var labels = host.Split('.');
        if (!labels.All(IsHostLabel)) return false;
        return schemeLength >= 0 || labels.Length >= 2 || Ev.AsciiLower(host) == "localhost";
    }

    /// <summary>The length of a leading <c>[A-Za-z][A-Za-z0-9+.-]*://</c>, or -1.</summary>
    private static int SchemeWithAuthorityLength(string text)
    {
        if (text.Length == 0 || !Ev.IsAsciiLetter(text[0])) return -1;
        var i = 1;
        while (i < text.Length && (Ev.IsAsciiLetter(text[i]) || Ev.IsAsciiDigit(text[i]) || text[i] is '+' or '.' or '-')) i++;
        return text.AsSpan(i).StartsWith("://", StringComparison.Ordinal) ? i + 3 : -1;
    }

    // ---- Defaults and editor rules (§2.11) ---------------------------------------------------------

    /// <summary>
    /// A new event's draft (§2.11): untitled, repeat Never, no alerts. Timed (default): on <paramref name="day"/>
    /// at the next whole hour after <paramref name="now"/> when the day is today (23:00 when the next whole
    /// hour would be tomorrow), on any other day at 09:00; one hour long; Busy; zone <paramref name="timeZone"/>
    /// (pass the device zone; null: floating). All-day: the whole day, no zone, Free. TS: <c>newEventDraft</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a 24:00 <paramref name="now"/> or an empty zone.</exception>
    public static EventDraft New(GregorianDate day, LocalDateTime now, string calendarId, bool allDay = false, string? timeZone = null)
    {
        ArgumentNullException.ThrowIfNull(calendarId);
        EventTime.AssertPlain(now, "now");
        if (timeZone is { Length: 0 }) throw Ev.Fail("newEventDraft option 'timeZone' must be a non-empty string or null, got \"\"");
        var dayStart = (long)day.JulianDayNumber * Ev.Day;
        var startMinute = 0;
        long length = Ev.Day;
        if (!allDay)
        {
            var nextHour = (now.Minute / 60 + 1) * 60;
            startMinute = day == now.Date ? Math.Min(nextHour, 23 * 60) : Nine;
            length = 60;
        }
        var start = dayStart + startMinute;
        return new EventDraft
        {
            AllDay = allDay,
            Start = LocalDateTime.FromAbsolute(start)!.Value,
            End = LocalDateTime.FromAbsoluteEnd(start + length, start)!.Value,
            TimeZone = allDay ? null : timeZone,
            CalendarId = calendarId,
            Availability = allDay ? Availability.Free : Availability.Busy,
        };
    }

    /// <summary>Clamps an end to the supported range of end values.</summary>
    private static LocalDateTime EndAt(long absolute, long startAbsolute) =>
        LocalDateTime.FromAbsoluteEnd(Math.Clamp(absolute, LocalDateTime.MinAbsolute, LocalDateTime.MaxEndAbsolute), startAbsolute)!.Value;

    /// <summary>
    /// Moves a draft's start, as changing Starts or dragging does (§2.11): the end moves by the same amount, and
    /// the repeat is re-derived with <see cref="EventRecurrence.AdaptToStart"/>, which reports the change. An end
    /// that would pass 9999-12-31T24:00 stops there. <paramref name="system"/> is accepted for API symmetry.
    /// TS: <c>moveDraftStart</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a malformed draft or a start that is 24:00 or (all-day) not T00:00.</exception>
    public static MovedDraft MoveStart(EventDraft draft, LocalDateTime start, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        ArgumentNullException.ThrowIfNull(draft);
        draft.AssertValid("event draft");
        EventTime.AssertPlain(start, "new start");
        _ = system.Definition();
        if (draft.AllDay && start.Minute != 0) throw Ev.Fail("An all-day draft starts at T00:00");
        var oldStart = draft.Start.Absolute;
        var newStart = start.Absolute;
        var end = EndAt(newStart + draft.End.Absolute - oldStart, newStart);
        EventRecurrence? recurrence = null;
        var change = RepeatChange.None;
        if (draft.Recurrence is not null)
        {
            var adapted = draft.Recurrence.AdaptToStart(draft.Start.Date, start.Date);
            recurrence = adapted.Recurrence;
            change = adapted.Change;
        }
        return new MovedDraft(draft.ToDraft() with { Start = start, End = end, Recurrence = recurrence }, change);
    }

    /// <summary>
    /// Turns all-day on or off (§2.11). On: keeps the dates the event covers, <c>T00:00</c> of the first day to
    /// <c>T24:00</c> of the last, no zone, Free unless <paramref name="availabilityTouched"/>. Off: the first day at
    /// <paramref name="previousTimes"/> start to the last day at its end (or 09:00 to 10:00; an end before the
    /// start moves to the next day), zone <paramref name="timeZone"/> (pass the device zone for a new event and
    /// the draft's earlier zone for an existing one; null: floating), Busy unless
    /// <paramref name="availabilityTouched"/>. Repeat and alerts are kept. TS: <c>setDraftAllDay</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for a malformed draft, previous times outside 0..1439 and
    /// 0..1440, or an empty zone.
    /// </exception>
    public static EventDraft SetAllDay(EventDraft draft, bool allDay, PreviousTimes? previousTimes = null, bool availabilityTouched = false, string? timeZone = null)
    {
        ArgumentNullException.ThrowIfNull(draft);
        draft.AssertValid("event draft");
        if (timeZone is { Length: 0 }) throw Ev.Fail("setDraftAllDay option 'timeZone' must be a non-empty string or null, got \"\"");
        if (previousTimes is { } p && (p.Start is < 0 or >= Ev.Day || p.End is < 0 or > Ev.Day))
        {
            throw Ev.Fail($"setDraftAllDay option 'previousTimes' must be {{ start: 0..1439, end: 0..1440 }}, got {{ start: {p.Start.Inv()}, end: {p.End.Inv()} }}");
        }
        var copy = draft.ToDraft();
        if (allDay == draft.AllDay) return copy;
        var startAbsolute = draft.Start.Absolute;
        var endAbsolute = draft.End.Absolute;
        long firstDay = draft.Start.Date.JulianDayNumber;
        if (allDay)
        {
            // The last covered day: the date of the end in end-of-day form, or the first day.
            var lastDay = endAbsolute > startAbsolute ? Ev.CeilDiv(endAbsolute, Ev.Day) - 1 : firstDay;
            return copy with
            {
                AllDay = true,
                Start = LocalDateTime.FromAbsolute(firstDay * Ev.Day)!.Value,
                End = LocalDateTime.FromAbsoluteEnd((lastDay + 1) * Ev.Day, firstDay * Ev.Day)!.Value,
                TimeZone = null,
                Availability = availabilityTouched ? draft.Availability : Availability.Free,
            };
        }
        // An all-day end is T00:00 or T24:00, so the end divides into whole days.
        var lastTimedDay = endAbsolute > startAbsolute ? Ev.FloorDiv(endAbsolute, Ev.Day) - 1 : firstDay;
        var startMinute = previousTimes?.Start ?? Nine;
        var endMinute = previousTimes?.End ?? Nine + 60;
        var start = firstDay * Ev.Day + startMinute;
        var end = lastTimedDay * Ev.Day + endMinute;
        if (end < start) end += Ev.Day;
        return copy with
        {
            AllDay = false,
            Start = LocalDateTime.FromAbsolute(start)!.Value,
            End = EndAt(end, start),
            TimeZone = timeZone,
            Availability = availabilityTouched ? draft.Availability : Availability.Busy,
        };
    }

    // ---- Changes and the three-way merge (§2.11, §4.9) ------------------------------------------------

    private static bool AlarmsEqual(IReadOnlyList<Alarm> a, IReadOnlyList<Alarm> b)
    {
        if (a.Count != b.Count) return false;
        for (var i = 0; i < a.Count; i++)
        {
            var same = (a[i], b[i]) switch
            {
                (Alarm.RelativeAlarm x, Alarm.RelativeAlarm y) => x.OffsetMinutes == y.OffsetMinutes,
                (Alarm.AbsoluteAlarm x, Alarm.AbsoluteAlarm y) => x.At.Absolute == y.At.Absolute,
                _ => false,
            };
            if (!same) return false;
        }
        return true;
    }

    internal static bool GroupEquals(DraftField field, EventDraft a, EventDraft b) => field switch
    {
        DraftField.Title => a.Title == b.Title,
        DraftField.Location => a.Location == b.Location,
        DraftField.Notes => a.Notes == b.Notes,
        DraftField.Url => a.Url == b.Url,
        DraftField.Availability => a.Availability == b.Availability,
        DraftField.Calendar => a.CalendarId == b.CalendarId,
        DraftField.Time => a.AllDay == b.AllDay && a.TimeZone == b.TimeZone && a.Start.Absolute == b.Start.Absolute && a.End.Absolute == b.End.Absolute,
        DraftField.Recurrence => Equals(a.Recurrence, b.Recurrence),
        DraftField.Alarms => AlarmsEqual(a.Alarms, b.Alarms),
        _ => true,
    };

    internal static List<DraftField> Written(EventDraft a, EventDraft b) => Enum.GetValues<DraftField>().Where(f => !GroupEquals(f, a, b)).ToList();
}

/// <summary>The result of <see cref="DraftMerge.Merge"/>.</summary>
/// <param name="Merged">A fresh draft.</param>
/// <param name="Written">The groups the platform writes.</param>
/// <param name="Conflicts">Written groups that also changed elsewhere, differently.</param>
public sealed record MergeResult(EventDraft Merged, ValueList<DraftField> Written, ValueList<DraftField> Conflicts);

/// <summary>The retime options <see cref="DraftMerge.ApplyToSeries"/> returns (for <see cref="EventRecurrence.Retime"/>).</summary>
public sealed record SeriesRetime(int MinuteDelta, AllDayChange? AllDay);

/// <summary>The result of <see cref="DraftMerge.ApplyToSeries"/>.</summary>
public sealed record SeriesEdit(EventDraft Master, EventDraft? Override, ValueList<DraftField> Written, SeriesRetime? Retime);

/// <summary>Changed fields, the three-way merge and "Save for all events" (§2.11, §4.7, §4.9). TS: model.ts.</summary>
public static class DraftMerge
{
    /// <summary>
    /// The field groups in which <paramref name="b"/> differs from <paramref name="a"/>, in <see cref="DraftField"/>
    /// order. Time compares all-day, zone and the start and end moments (<c>D T24:00</c> equals
    /// <c>D+1 T00:00</c>); recurrence compares the whole value structurally; alarms the list in order.
    /// TS: <c>changedFields</c>.
    /// </summary>
    public static IReadOnlyList<DraftField> ChangedFields(EventDraft a, EventDraft b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        a.AssertValid("event draft");
        b.AssertValid("event draft");
        return Drafts.Written(a, b);
    }

    /// <summary>
    /// Three-way merge (§2.11, §4.9): the groups where <paramref name="edited"/> differs from
    /// <paramref name="original"/> are written and taken from <paramref name="edited"/>; every other group is
    /// taken from <paramref name="current"/> (the event as fetched again at save time). A written group is a
    /// conflict when <paramref name="current"/> also differs from both. TS: <c>mergeDraft</c>.
    /// </summary>
    public static MergeResult Merge(EventDraft original, EventDraft edited, EventDraft current)
    {
        ArgumentNullException.ThrowIfNull(original);
        ArgumentNullException.ThrowIfNull(edited);
        ArgumentNullException.ThrowIfNull(current);
        original.AssertValid("original draft");
        edited.AssertValid("edited draft");
        current.AssertValid("current draft");
        var written = Drafts.Written(original, edited);
        var conflicts = written.Where(f => !Drafts.GroupEquals(f, original, current) && !Drafts.GroupEquals(f, edited, current)).ToList();
        EventDraft From(DraftField field) => written.Contains(field) ? edited : current;
        var time = From(DraftField.Time);
        var merged = new EventDraft
        {
            Title = From(DraftField.Title).Title,
            Location = From(DraftField.Location).Location,
            Notes = From(DraftField.Notes).Notes,
            Url = From(DraftField.Url).Url,
            AllDay = time.AllDay,
            Start = time.Start,
            End = time.End,
            TimeZone = time.TimeZone,
            CalendarId = From(DraftField.Calendar).CalendarId,
            Recurrence = From(DraftField.Recurrence).Recurrence,
            Alarms = From(DraftField.Alarms).Alarms,
            Availability = From(DraftField.Availability).Availability,
        };
        return new MergeResult(merged, written, conflicts);
    }

    private sealed record TimeGroup(bool AllDay, LocalDateTime Start, LocalDateTime End, string? TimeZone);

    /// <summary>The time group the series master takes: its own first date, the edited start minute, the edited length, all-day and zone.</summary>
    private static TimeGroup SeriesTime(EventDraft master, EventDraft edited)
    {
        long firstDay = master.Start.Date.JulianDayNumber;
        var editedStart = edited.Start.Absolute;
        var editedEnd = edited.End.Absolute;
        if (edited.AllDay)
        {
            var days = Math.Max(1, Ev.CeilDiv(editedEnd - editedStart, Ev.Day));
            var start = firstDay * Ev.Day;
            return new TimeGroup(true, LocalDateTime.FromAbsolute(start)!.Value, EndAt(start + days * Ev.Day, start), null);
        }
        var timedStart = firstDay * Ev.Day + edited.Start.Minute;
        return new TimeGroup(false, LocalDateTime.FromAbsolute(timedStart)!.Value, EndAt(timedStart + editedEnd - editedStart, timedStart), edited.TimeZone);
    }

    private static LocalDateTime EndAt(long absolute, long startAbsolute) =>
        LocalDateTime.FromAbsoluteEnd(Math.Clamp(absolute, LocalDateTime.MinAbsolute, LocalDateTime.MaxEndAbsolute), startAbsolute)!.Value;

    /// <summary><paramref name="baseDraft"/> with the groups in <paramref name="fields"/> taken from <paramref name="from"/> (the time group from <paramref name="time"/>).</summary>
    private static EventDraft WithGroups(EventDraft baseDraft, EventDraft from, IReadOnlyCollection<DraftField> fields, TimeGroup time)
    {
        EventDraft Pick(DraftField field) => fields.Contains(field) ? from : baseDraft;
        return new EventDraft
        {
            Title = Pick(DraftField.Title).Title,
            Location = Pick(DraftField.Location).Location,
            Notes = Pick(DraftField.Notes).Notes,
            Url = Pick(DraftField.Url).Url,
            AllDay = time.AllDay,
            Start = time.Start,
            End = time.End,
            TimeZone = time.TimeZone,
            CalendarId = Pick(DraftField.Calendar).CalendarId,
            Recurrence = Pick(DraftField.Recurrence).Recurrence,
            Alarms = Pick(DraftField.Alarms).Alarms,
            Availability = Pick(DraftField.Availability).Availability,
        };
    }

    private static TimeGroup TimeOf(EventDraft draft) => new(draft.AllDay, draft.Start, draft.End, draft.TimeZone);

    /// <summary>
    /// "Save for all events" (§4.7, §2.11): applies the changes made on one occurrence (<paramref name="opened"/>
    /// as shown, <paramref name="edited"/> as saved) to the series <paramref name="master"/>, fetched again at
    /// save time, without taking the occurrence's date. Written groups other than time come from
    /// <paramref name="edited"/>; when time is written the master keeps its own start date and takes the edited
    /// start minute as an absolute wall-clock time, the edited length, all-day and zone. <paramref name="override"/>
    /// gets the same written groups (its repeat never), its time group as edited. <c>Retime</c> holds the
    /// <see cref="EventRecurrence.Retime"/> options to apply next (null when time is not written).
    /// TS: <c>applyToSeries</c>.
    /// </summary>
    public static SeriesEdit ApplyToSeries(EventDraft master, EventDraft opened, EventDraft edited, EventDraft? @override)
    {
        ArgumentNullException.ThrowIfNull(master);
        ArgumentNullException.ThrowIfNull(opened);
        ArgumentNullException.ThrowIfNull(edited);
        master.AssertValid("series master");
        opened.AssertValid("opened draft");
        edited.AssertValid("edited draft");
        @override?.AssertValid("override");
        var written = Drafts.Written(opened, edited);
        var timeWritten = written.Contains(DraftField.Time);
        var time = timeWritten ? SeriesTime(master, edited) : TimeOf(master);
        var merged = WithGroups(master, edited, written, time);
        SeriesRetime? retime = timeWritten
            ? new SeriesRetime(
                time.Start.Minute - master.Start.Minute,
                time.AllDay == master.AllDay ? null : time.AllDay ? AllDayChange.ToAllDay : AllDayChange.ToTimed)
            : null;
        var mergedOverride = @override is null
            ? null
            : WithGroups(@override, edited, written.Where(f => f != DraftField.Recurrence).ToList(), timeWritten ? TimeOf(edited) : TimeOf(@override));
        return new SeriesEdit(merged, mergedOverride, written, retime);
    }
}
