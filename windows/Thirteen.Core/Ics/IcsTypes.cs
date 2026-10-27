using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// Types of the .ics module (docs/EVENTS.md §5.4), mirroring packages/core/src/ics/types.ts: an iCalendar
// text as Windows and the web store, import, export and subscribe to it.
//
// The model keeps what Thirteen understands as fields and everything else verbatim, and it keeps the text it
// was read from: a component with Raw text is written back byte for byte (§3.6), and an edited component keeps
// its Original text so that the properties of the fields the user did not touch are written back as read
// (§4.9). Every list is a ValueList, so the records compare by content (TS plainEquals).

/// <summary>
/// A DATE or DATE-TIME value as written: a date, a floating or UTC date-time, or a date-time in a <c>TZID</c>
/// (minute precision). TS: <c>IcsDateValue</c>.
/// </summary>
public abstract record IcsDateValue
{
    private protected IcsDateValue()
    {
    }

    /// <summary><c>"date"</c>, <c>"floating"</c>, <c>"utc"</c> or <c>"zoned"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>The date, or the date of the wall clock. TS: <c>dateOfValue</c>.</summary>
    public abstract GregorianDate DateOf { get; }

    /// <summary>A <c>VALUE=DATE</c> value.</summary>
    public static IcsDateValue OnDate(GregorianDate date) => new DateValue(date);

    /// <summary>A floating date-time (no <c>TZID</c>, no <c>Z</c>).</summary>
    public static IcsDateValue Floating(LocalDateTime value) => new FloatingValue(value);

    /// <summary>A UTC date-time (<c>Z</c>).</summary>
    public static IcsDateValue Utc(LocalDateTime value) => new UtcValue(value);

    /// <summary>A date-time in <paramref name="tzid"/>, the parameter as written.</summary>
    public static IcsDateValue Zoned(LocalDateTime value, string tzid) => new ZonedValue(value, tzid);

    private static LocalDateTime Checked(LocalDateTime value)
    {
        if (value.IsEndOfDay) throw ThirteenException.InvalidIcs($"An IcsDateValue wall clock must be 00:00..23:59, got {value}");
        return value;
    }

    /// <summary>A date (<c>VALUE=DATE</c>).</summary>
    public sealed record DateValue(GregorianDate Date) : IcsDateValue
    {
        /// <inheritdoc />
        public override string Kind => "date";

        /// <inheritdoc />
        public override GregorianDate DateOf => Date;

        /// <inheritdoc />
        public override string ToString() => $"date {Date.ToIsoString()}";
    }

    /// <summary>A floating date-time.</summary>
    public sealed record FloatingValue : IcsDateValue
    {
        /// <summary>A validated value (minute 0..1439).</summary>
        public FloatingValue(LocalDateTime value)
        {
            Value = Checked(value);
        }

        /// <summary>The wall clock.</summary>
        public LocalDateTime Value { get; }

        /// <inheritdoc />
        public override string Kind => "floating";

        /// <inheritdoc />
        public override GregorianDate DateOf => Value.Date;

        /// <inheritdoc />
        public override string ToString() => $"floating {Value}";
    }

    /// <summary>A UTC date-time.</summary>
    public sealed record UtcValue : IcsDateValue
    {
        /// <summary>A validated value (minute 0..1439).</summary>
        public UtcValue(LocalDateTime value)
        {
            Value = Checked(value);
        }

        /// <summary>The UTC wall clock.</summary>
        public LocalDateTime Value { get; }

        /// <inheritdoc />
        public override string Kind => "utc";

        /// <inheritdoc />
        public override GregorianDate DateOf => Value.Date;

        /// <inheritdoc />
        public override string ToString() => $"utc {Value}";
    }

    /// <summary>A date-time in a <c>TZID</c>: an IANA id, a Windows id, or a name only the file's own <c>VTIMEZONE</c> defines.</summary>
    public sealed record ZonedValue : IcsDateValue
    {
        /// <summary>A validated value (minute 0..1439, non-empty <paramref name="tzid"/>).</summary>
        public ZonedValue(LocalDateTime value, string tzid)
        {
            Value = Checked(value);
            Tzid = string.IsNullOrEmpty(tzid) ? throw ThirteenException.InvalidIcs("A zoned IcsDateValue needs a non-empty tzid") : tzid;
        }

        /// <summary>The wall clock in <see cref="Tzid"/>.</summary>
        public LocalDateTime Value { get; }

        /// <summary>The <c>TZID</c> parameter as written (without quotes).</summary>
        public string Tzid { get; }

        /// <inheritdoc />
        public override string Kind => "zoned";

        /// <inheritdoc />
        public override GregorianDate DateOf => Value.Date;

        /// <inheritdoc />
        public override string ToString() => $"zoned {Value} {Tzid}";
    }
}

/// <summary>One parameter of a content line: its name in uppercase and its value exactly as written (quotes included).</summary>
public readonly record struct IcsParameter(string Name, string Value);

/// <summary>
/// A content line: its name in uppercase, its parameters and its value exactly as written (escapes not
/// decoded). TS: <c>IcsProperty</c>.
/// </summary>
public sealed record IcsProperty(string Name, ValueList<IcsParameter> Params, string Value)
{
    /// <summary>A property without parameters.</summary>
    public IcsProperty(string name, string value) : this(name, ValueList<IcsParameter>.Empty, value)
    {
    }
}

/// <summary>What a relative <c>TRIGGER</c> is relative to.</summary>
public enum IcsTriggerRelation
{
    /// <summary><c>"start"</c> (the default).</summary>
    Start,
    /// <summary><c>"end"</c> (<c>RELATED=END</c>).</summary>
    End,
}

/// <summary>A <c>TRIGGER</c>: a duration relative to the start or end, or an absolute time. TS: <c>IcsTrigger</c>.</summary>
public abstract record IcsTrigger
{
    private protected IcsTrigger()
    {
    }

    /// <summary><c>"relative"</c> or <c>"absolute"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>A duration in minutes (negative: before) relative to the start or end.</summary>
    public sealed record Relative(long Minutes, IcsTriggerRelation Related) : IcsTrigger
    {
        /// <inheritdoc />
        public override string Kind => "relative";
    }

    /// <summary>An absolute time (<c>VALUE=DATE-TIME</c>).</summary>
    public sealed record Absolute(IcsDateValue Value) : IcsTrigger
    {
        /// <inheritdoc />
        public override string Kind => "absolute";
    }
}

/// <summary>A <c>VALARM</c>: its <c>ACTION</c> (uppercase), its <c>TRIGGER</c>, and every other property verbatim, in order. TS: <c>IcsAlarm</c>.</summary>
public sealed record IcsAlarm(string Action, IcsTrigger Trigger, ValueList<IcsProperty> Extra);

/// <summary>
/// One <c>RDATE</c> value; <see cref="Period"/> is the text after the <c>/</c> of a <c>VALUE=PERIOD</c> value (an
/// end or a duration), else null. TS: <c>IcsRdate</c>.
/// </summary>
public sealed record IcsRdate(IcsDateValue Value, string? Period);

/// <summary>A <c>VEVENT</c> (a series master, a single event or an override). TS: <c>IcsEvent</c>.</summary>
public sealed record IcsEvent
{
    /// <summary>The <c>UID</c> (decoded).</summary>
    public required string Uid { get; init; }

    /// <summary><c>true</c>: the component had no <c>UID</c> and <see cref="Uid"/> is the derived <c>missing-{32 hex}</c> (§2.17).</summary>
    public bool UidDerived { get; init; }

    /// <summary>The <c>RECURRENCE-ID</c>, or null for a master or single event.</summary>
    public IcsDateValue? RecurrenceId { get; init; }

    /// <summary>The <c>SEQUENCE</c> (0 when absent).</summary>
    public int Sequence { get; init; }

    /// <summary>The decoded <c>SUMMARY</c>; empty when absent.</summary>
    public string Summary { get; init; } = "";

    /// <summary>The decoded <c>LOCATION</c>; empty when absent.</summary>
    public string Location { get; init; } = "";

    /// <summary>The decoded <c>DESCRIPTION</c>; empty when absent.</summary>
    public string Description { get; init; } = "";

    /// <summary>The <c>URL</c>; empty when absent.</summary>
    public string Url { get; init; } = "";

    /// <summary>The <c>DTSTART</c>.</summary>
    public required IcsDateValue Start { get; init; }

    /// <summary>The <c>DTEND</c>, or null.</summary>
    public IcsDateValue? End { get; init; }

    /// <summary>The <c>DURATION</c> text, e.g. <c>PT1H30M</c>, or null.</summary>
    public string? Duration { get; init; }

    /// <summary>The <c>RRULE</c>s.</summary>
    public ValueList<RRule> RRules { get; init; } = ValueList<RRule>.Empty;

    /// <summary>The <c>EXRULE</c>s.</summary>
    public ValueList<RRule> ExRules { get; init; } = ValueList<RRule>.Empty;

    /// <summary>The <c>RDATE</c> values, in order.</summary>
    public ValueList<IcsRdate> Rdates { get; init; } = ValueList<IcsRdate>.Empty;

    /// <summary>The <c>EXDATE</c> values, in order.</summary>
    public ValueList<IcsDateValue> Exdates { get; init; } = ValueList<IcsDateValue>.Empty;

    /// <summary>The uppercase <c>STATUS</c>, or null.</summary>
    public string? Status { get; init; }

    /// <summary>The uppercase <c>TRANSP</c>, or null.</summary>
    public string? Transp { get; init; }

    /// <summary>The <c>X-THIRTEEN-RULE;VERSION=1</c> value, or null.</summary>
    public string? ThirteenRule { get; init; }

    /// <summary>The readable <c>VALARM</c>s.</summary>
    public ValueList<IcsAlarm> Alarms { get; init; } = ValueList<IcsAlarm>.Empty;

    /// <summary>The <c>CREATED</c>, or null.</summary>
    public IcsDateValue? Created { get; init; }

    /// <summary>The <c>LAST-MODIFIED</c>, or null.</summary>
    public IcsDateValue? LastModified { get; init; }

    /// <summary>The <c>DTSTAMP</c>, or null.</summary>
    public IcsDateValue? Dtstamp { get; init; }

    /// <summary>The <c>X-THIRTEEN-IMPORTED-LAST-MODIFIED</c> import baseline (§3.6), or null.</summary>
    public IcsDateValue? ImportedLastModified { get; init; }

    /// <summary>Every other property, verbatim, in order (also a known property whose value could not be read).</summary>
    public ValueList<IcsProperty> Extra { get; init; } = ValueList<IcsProperty>.Empty;

    /// <summary>The component's text as read (BEGIN to END, CRLF line ends, folding included); null once edited or for new events.</summary>
    public string? Raw { get; init; }

    /// <summary>
    /// The component's text as read, kept when the event is edited (<see cref="Raw"/> cleared), so the writer keeps
    /// the properties of untouched fields as read; null for new events.
    /// </summary>
    public string? Original { get; init; }

    /// <summary>The 1-based line on which the component begins in the text it was read from; the writer keeps that order. Null for new events.</summary>
    public int? Line { get; init; }
}

/// <summary>A UID group: a master and its <c>RECURRENCE-ID</c> overrides, which always move together (§2.17). TS: <c>IcsGroup</c>.</summary>
public sealed record IcsGroup(string Uid, IcsEvent? Master, ValueList<IcsEvent> Overrides)
{
    /// <summary>The master (when there is one), then the overrides.</summary>
    public IEnumerable<IcsEvent> Members => Master is null ? Overrides : Overrides.Prepend(Master);
}

/// <summary>The kind of a <c>VTIMEZONE</c> observance.</summary>
public enum IcsObservanceKind
{
    /// <summary><c>STANDARD</c>.</summary>
    Standard,
    /// <summary><c>DAYLIGHT</c>.</summary>
    Daylight,
}

/// <summary>A <c>STANDARD</c> or <c>DAYLIGHT</c> observance of a <c>VTIMEZONE</c>. Offsets are minutes east of UTC. TS: <c>IcsObservance</c>.</summary>
/// <param name="Kind">Standard or daylight.</param>
/// <param name="Start"><c>DTSTART</c>, local time (in <paramref name="OffsetFrom"/>).</param>
/// <param name="OffsetFrom"><c>TZOFFSETFROM</c>.</param>
/// <param name="OffsetTo"><c>TZOFFSETTO</c>.</param>
/// <param name="RRules">The <c>RRULE</c>s.</param>
/// <param name="Rdates">The <c>RDATE</c> values, local time.</param>
/// <param name="Names">The <c>TZNAME</c> values.</param>
public sealed record IcsObservance(
    IcsObservanceKind Kind,
    LocalDateTime Start,
    int OffsetFrom,
    int OffsetTo,
    ValueList<RRule> RRules,
    ValueList<LocalDateTime> Rdates,
    ValueList<string> Names);

/// <summary>The years a generated <c>VTIMEZONE</c> was built for (<c>X-THIRTEEN-GENERATED:{First}-{Last}</c>, §5.4).</summary>
public readonly record struct IcsYearRange(int First, int Last);

/// <summary>A <c>VTIMEZONE</c>. TS: <c>IcsTimeZone</c>.</summary>
/// <param name="Tzid">The <c>TZID</c>.</param>
/// <param name="Observances">The readable observances.</param>
/// <param name="Raw">The component's text as read; null for generated or renamed definitions, which are written from <paramref name="Observances"/>.</param>
/// <param name="Generated">The years a definition Thirteen generated was built for, or null.</param>
/// <param name="Line">As <see cref="IcsEvent.Line"/>.</param>
public sealed record IcsTimeZone(string Tzid, ValueList<IcsObservance> Observances, string? Raw, IcsYearRange? Generated, int? Line);

/// <summary>A component the reader does not model (<c>VTODO</c>, <c>VJOURNAL</c>, a broken or duplicate <c>VEVENT</c>), kept as read and written back. TS: <c>IcsOtherComponent</c>.</summary>
/// <param name="Name">Uppercase component name.</param>
/// <param name="Raw">The component's text as read.</param>
/// <param name="Line">As <see cref="IcsEvent.Line"/>.</param>
public sealed record IcsOtherComponent(string Name, string Raw, int? Line);

/// <summary>The code of an <see cref="IcsWarning"/>.</summary>
public enum IcsWarningCode
{
    /// <summary><c>bad-line</c>.</summary>
    BadLine,
    /// <summary><c>bad-date</c>.</summary>
    BadDate,
    /// <summary><c>bad-rrule</c>.</summary>
    BadRRule,
    /// <summary><c>unknown-tzid</c>.</summary>
    UnknownTzid,
    /// <summary><c>missing-uid</c>.</summary>
    MissingUid,
    /// <summary><c>missing-dtstart</c>.</summary>
    MissingDtstart,
    /// <summary><c>unclosed-component</c>.</summary>
    UnclosedComponent,
    /// <summary><c>skipped-component</c>.</summary>
    SkippedComponent,
    /// <summary><c>duplicate-uid</c>.</summary>
    DuplicateUid,
    /// <summary><c>out-of-range</c>.</summary>
    OutOfRange,
}

/// <summary>A problem the reader (or the expansion) met; parsing always continues. TS: <c>IcsWarning</c>.</summary>
/// <param name="Line">1-based line of the text, or 0 when the problem has no line (an expansion warning).</param>
/// <param name="Code">What happened.</param>
/// <param name="Detail">Informative English.</param>
public sealed record IcsWarning(int Line, IcsWarningCode Code, string Detail);

/// <summary>A calendar text. TS: <c>IcsCalendar</c>.</summary>
public sealed record IcsCalendar
{
    /// <summary><c>X-WR-CALNAME</c>, else <c>NAME</c>.</summary>
    public string? Name { get; init; }

    /// <summary><c>#rrggbb</c> (lowercase) from <c>X-APPLE-CALENDAR-COLOR</c>, else from the CSS color name of <c>COLOR</c>.</summary>
    public string? Color { get; init; }

    /// <summary>The <c>REFRESH-INTERVAL</c> duration text, else <c>X-PUBLISHED-TTL</c>.</summary>
    public string? RefreshInterval { get; init; }

    /// <summary>The UID groups, in reading order.</summary>
    public ValueList<IcsGroup> Groups { get; init; } = ValueList<IcsGroup>.Empty;

    /// <summary>The <c>VTIMEZONE</c>s.</summary>
    public ValueList<IcsTimeZone> TimeZones { get; init; } = ValueList<IcsTimeZone>.Empty;

    /// <summary>Every calendar property, verbatim, in order (including those behind the fields above).</summary>
    public ValueList<IcsProperty> Extra { get; init; } = ValueList<IcsProperty>.Empty;

    /// <summary>The reader's warnings, by line.</summary>
    public ValueList<IcsWarning> Warnings { get; init; } = ValueList<IcsWarning>.Empty;

    /// <summary>Components kept as read but not modeled.</summary>
    public ValueList<IcsOtherComponent> Others { get; init; } = ValueList<IcsOtherComponent>.Empty;

    /// <summary>The calendar's own property lines as read (CRLF line ends), so unchanged properties are written back as read; null for new calendars.</summary>
    public string? Raw { get; init; }
}

/// <summary>How a <c>TZID</c> resolves (§5.4).</summary>
public enum ZoneHandleKind
{
    /// <summary>An IANA id the platform knows.</summary>
    Iana,
    /// <summary>A Windows id mapped to IANA through the CLDR table.</summary>
    Windows,
    /// <summary>The file's own <c>VTIMEZONE</c>.</summary>
    VTimeZone,
    /// <summary>Unknown: read as floating.</summary>
    Floating,
}

/// <summary>
/// How a <c>TZID</c> resolves (§5.4): a zone the platform knows (an IANA id, or the IANA id a Windows id maps to
/// through the CLDR table), the file's own <c>VTIMEZONE</c>, or floating (unknown). TS: <c>ZoneHandle</c>.
/// </summary>
/// <param name="Kind">How it resolved.</param>
/// <param name="Tzid">The <c>TZID</c> as written.</param>
/// <param name="Zone">The IANA id for <see cref="ZoneHandleKind.Iana"/> and <see cref="ZoneHandleKind.Windows"/>, else null.</param>
/// <param name="TimeZone">The definition for <see cref="ZoneHandleKind.VTimeZone"/>, else null.</param>
/// <param name="Resolver">Answers offsets for this handle (the platform's resolver, or one built from the <c>VTIMEZONE</c>); null for floating.</param>
public sealed record ZoneHandle(ZoneHandleKind Kind, string Tzid, string? Zone, IcsTimeZone? TimeZone, IZoneResolver? Resolver);

/// <summary>
/// The <c>DTEND</c> or <c>DURATION</c> of an all-day event (§3.1.1): see <see cref="IcsGroups.AllDayEnd"/>.
/// </summary>
/// <param name="End">The <c>DTEND;VALUE=DATE</c>, or null.</param>
/// <param name="Duration"><c>P{n}D</c> for an event of n days ending on 9999-12-31, else null.</param>
public readonly record struct IcsAllDayEnd(IcsDateValue? End, string? Duration);

/// <summary>
/// One occurrence of a calendar, in the device's wall clock, with what the platform needs to open and edit it.
/// TS: <c>IcsExpandedEvent</c> (an <c>EventOccurrence</c> with more fields; <see cref="ToOccurrence"/> gives the
/// <see cref="EventOccurrence"/>).
/// </summary>
/// <param name="Key"><c>{calendarId}/{UID}|{original start}</c> (§3.2), with <c>#n</c> for duplicates.</param>
/// <param name="CalendarId">The calendar id.</param>
/// <param name="Title">The component's summary.</param>
/// <param name="AllDay">All-day.</param>
/// <param name="Start">Device wall clock.</param>
/// <param name="End">Device wall clock, end-of-day form.</param>
/// <param name="Uid">The group's UID.</param>
/// <param name="Group">Index of its group in <see cref="IcsCalendar.Groups"/>.</param>
/// <param name="Component">The <c>VEVENT</c> this occurrence shows: the override that replaced it, or the master.</param>
/// <param name="OriginalDate">The original occurrence (<c>RECURRENCE-ID</c>) in the series' zone.</param>
/// <param name="OriginalMinute">Null: the master's start time.</param>
/// <param name="Recurring">The group's master repeats (<c>RRULE</c> or <c>RDATE</c>).</param>
/// <param name="Orphan">An override shown on its own: its group has no master, or the master does not produce its original date.</param>
/// <param name="Status">The component's status.</param>
/// <param name="Zone">The zone of the component's start: an IANA id, the <c>TZID</c> of a file-defined zone, or <c>UTC</c>; null for floating and all-day events.</param>
/// <param name="StartUtc">The start instant as a UTC wall clock (timed occurrences; null for all-day ones), for <see cref="Alarm.FireTime(Alarm, bool, LocalDateTime, LocalDateTime?, string, IZoneResolver)"/> (§2.14).</param>
public sealed record IcsExpandedEvent(
    string Key,
    string CalendarId,
    string Title,
    bool AllDay,
    LocalDateTime Start,
    LocalDateTime End,
    string Uid,
    int Group,
    IcsEvent Component,
    GregorianDate OriginalDate,
    int? OriginalMinute,
    bool Recurring,
    bool Orphan,
    EventStatus Status,
    string? Zone,
    LocalDateTime? StartUtc)
{
    /// <summary>The plain occurrence (key, calendar id, title, all-day, start, end).</summary>
    public EventOccurrence ToOccurrence() => new(Key, CalendarId, Title, AllDay, Start, End);
}

/// <summary>The result of <see cref="IcsExpansion.ExpandCalendar"/>.</summary>
/// <param name="Events">Sorted by start, then key.</param>
/// <param name="Warnings"><c>out-of-range</c> warnings, by line.</param>
public sealed record IcsExpansionResult(ValueList<IcsExpandedEvent> Events, ValueList<IcsWarning> Warnings);

/// <summary>The result of <see cref="IcsMerge.ImportCalendar"/>: the merged calendar and the UID groups counted (§2.17 step 4).</summary>
/// <param name="Calendar">The target with the file merged in.</param>
/// <param name="Added">Groups new to the target.</param>
/// <param name="Updated">Groups that replaced a stored one, or added or replaced overrides of it.</param>
/// <param name="Unchanged">Groups the target already held in the same or a later version.</param>
/// <param name="Skipped">Further masters of one UID in the file.</param>
public sealed record IcsImportResult(IcsCalendar Calendar, int Added, int Updated, int Unchanged, int Skipped);

/// <summary>The result of <see cref="IcsMerge.RestoreCalendar"/>: the restored calendar and the backup's UID groups counted (§2.17 "Restore").</summary>
/// <param name="Calendar">The target with the backup restored into it.</param>
/// <param name="Added">Groups only in the backup.</param>
/// <param name="Updated">Groups the backup holds in a later version.</param>
/// <param name="Unchanged">Groups in the same version.</param>
/// <param name="KeptNewer">Groups the calendar holds in a later version (kept).</param>
public sealed record IcsRestoreResult(IcsCalendar Calendar, int Added, int Updated, int Unchanged, int KeptNewer);

/// <summary>Text forms of the .ics enums (the TypeScript and JSON values).</summary>
public static class IcsText
{
    /// <summary><c>bad-line</c>, <c>bad-date</c>, ...</summary>
    public static string RawValue(this IcsWarningCode code) => code switch
    {
        IcsWarningCode.BadLine => "bad-line",
        IcsWarningCode.BadDate => "bad-date",
        IcsWarningCode.BadRRule => "bad-rrule",
        IcsWarningCode.UnknownTzid => "unknown-tzid",
        IcsWarningCode.MissingUid => "missing-uid",
        IcsWarningCode.MissingDtstart => "missing-dtstart",
        IcsWarningCode.UnclosedComponent => "unclosed-component",
        IcsWarningCode.SkippedComponent => "skipped-component",
        IcsWarningCode.DuplicateUid => "duplicate-uid",
        _ => "out-of-range",
    };

    /// <summary><c>start</c> or <c>end</c>.</summary>
    public static string RawValue(this IcsTriggerRelation relation) => relation == IcsTriggerRelation.End ? "end" : "start";

    /// <summary><c>standard</c> or <c>daylight</c>.</summary>
    public static string RawValue(this IcsObservanceKind kind) => kind == IcsObservanceKind.Daylight ? "daylight" : "standard";

    /// <summary><c>iana</c>, <c>windows</c>, <c>vtimezone</c> or <c>floating</c>.</summary>
    public static string RawValue(this ZoneHandleKind kind) => kind switch
    {
        ZoneHandleKind.Iana => "iana",
        ZoneHandleKind.Windows => "windows",
        ZoneHandleKind.VTimeZone => "vtimezone",
        _ => "floating",
    };
}
