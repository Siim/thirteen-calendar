namespace Thirteen.Core.Events;

// The recurrence types of docs/EVENTS.md §5.2 (packages/core/src/events/recurrence.ts). A recurrence works
// on original dates in the event's zone; an ExtraDate or OriginalDate has a minute only when it differs
// from the master's start minute (null stands for the master's minute). Two values are the same
// occurrence when their dates and minutes are equal.

/// <summary>
/// How a repeat ends: never, after a count of occurrences (counting the start), or on the last occurrence
/// on or before a date. TS: <c>RepeatEnd</c>.
/// </summary>
public abstract record RepeatEnd
{
    private RepeatEnd()
    {
    }

    /// <summary><c>"never"</c>, <c>"count"</c> or <c>"until"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>No end.</summary>
    public static RepeatEnd Never { get; } = new NeverEnd();

    /// <summary>After <paramref name="count"/> occurrences (1..999 in the editor; any integer is kept, see <see cref="DraftIssue.CountOutOfRange"/>).</summary>
    public static RepeatEnd AfterCount(int count) => new CountEnd(count);

    /// <summary>On the last occurrence on or before <paramref name="date"/>.</summary>
    public static RepeatEnd Until(GregorianDate date) => new UntilEnd(date);

    /// <summary>No end.</summary>
    public sealed record NeverEnd : RepeatEnd
    {
        /// <inheritdoc />
        public override string Kind => "never";
    }

    /// <summary>After <see cref="Count"/> occurrences.</summary>
    public sealed record CountEnd(int Count) : RepeatEnd
    {
        /// <inheritdoc />
        public override string Kind => "count";
    }

    /// <summary>On the last occurrence on or before <see cref="Date"/>.</summary>
    public sealed record UntilEnd(GregorianDate Date) : RepeatEnd
    {
        /// <inheritdoc />
        public override string Kind => "until";
    }
}

/// <summary>One <c>RRULE</c> or <c>EXRULE</c> with its own end (inside a foreign rule); the rule has no <c>COUNT</c> or <c>UNTIL</c>. TS: <c>EndedRule</c>.</summary>
public sealed record EndedRule(RRule RRule, RepeatEnd End);

/// <summary>The rule part of a recurrence. TS: <c>RepeatRule</c>.</summary>
public abstract record RepeatRule
{
    private RepeatRule()
    {
    }

    /// <summary><c>"rrule"</c>, <c>"thirteen"</c>, <c>"dates"</c> or <c>"foreign"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>One Gregorian rule.</summary>
    public static RepeatRule Of(RRule rrule) => new RRuleRepeat(rrule);

    /// <summary>A 13-month rule.</summary>
    public static RepeatRule Of(ThirteenRule rule) => new ThirteenRepeat(rule);

    /// <summary>No rule: the start plus the extra dates.</summary>
    public static RepeatRule Dates { get; } = new DatesRepeat();

    /// <summary>Several rules and exclusion rules, each with its own end.</summary>
    public static RepeatRule Foreign(ValueList<EndedRule> rules, ValueList<EndedRule> exrules) => new ForeignRepeat(rules, exrules);

    /// <summary>One Gregorian <c>RRULE</c>, without <c>COUNT</c> or <c>UNTIL</c> (they live in the <see cref="RepeatEnd"/>). Kind <c>rrule</c>.</summary>
    public sealed record RRuleRepeat(RRule RRule) : RepeatRule
    {
        /// <inheritdoc />
        public override string Kind => "rrule";
    }

    /// <summary>A 13-month rule (§4.2). Kind <c>thirteen</c>.</summary>
    public sealed record ThirteenRepeat(ThirteenRule Rule) : RepeatRule
    {
        /// <inheritdoc />
        public override string Kind => "thirteen";
    }

    /// <summary>No rule: the start plus the extra dates. Kind <c>dates</c>.</summary>
    public sealed record DatesRepeat : RepeatRule
    {
        /// <inheritdoc />
        public override string Kind => "dates";
    }

    /// <summary>Several <c>RRULE</c>s and/or <c>EXRULE</c>s, each with its own end; the recurrence's end is never. Kind <c>foreign</c>.</summary>
    public sealed record ForeignRepeat(ValueList<EndedRule> Rules, ValueList<EndedRule> Exrules) : RepeatRule
    {
        /// <inheritdoc />
        public override string Kind => "foreign";
    }
}

/// <summary>
/// An <c>RDATE</c>, or an expanded original date. <see cref="Minute"/> and <see cref="DurationMinutes"/>
/// null mean the master's start time and length (<c>RDATE;VALUE=PERIOD</c> sets both). TS: <c>ExtraDate</c>
/// (and <c>ExpandedDate</c>).
/// </summary>
public readonly record struct ExtraDate
{
    /// <summary>Validated: minute 0..1439 or null, duration 0 or more or null.</summary>
    public ExtraDate(GregorianDate date, int? minute = null, long? durationMinutes = null)
    {
        if (minute is < 0 or >= Ev.Day || durationMinutes is < 0)
        {
            throw Ev.RuleFail("Invalid recurrence: extraDates entries must be { date, minute: 0..1439 | null, durationMinutes: >= 0 | null }");
        }
        Date = date;
        Minute = minute;
        DurationMinutes = durationMinutes;
    }

    /// <summary>The date.</summary>
    public GregorianDate Date { get; }

    /// <summary>0..1439, or null for the master's start minute.</summary>
    public int? Minute { get; }

    /// <summary>
    /// 0 or more, or null for the master's length. A <c>long</c>, as TypeScript's number: an <c>RDATE;VALUE=PERIOD</c>
    /// may last past 9999-12-31T24:00 from any start (up to 5,258,966,400 minutes), more than an <c>int</c> holds.
    /// </summary>
    public long? DurationMinutes { get; }
}

/// <summary>
/// An original occurrence: an <c>EXDATE</c> value, a <c>RECURRENCE-ID</c> or an <c>ORIGINAL_INSTANCE_TIME</c>.
/// <see cref="Minute"/> null is the master's start time (or a DATE value); a minute is an extra date's own
/// time. TS: <c>OriginalDate</c>.
/// </summary>
public readonly record struct OriginalDate
{
    /// <summary>Validated: minute 0..1439 or null.</summary>
    public OriginalDate(GregorianDate date, int? minute = null)
    {
        if (minute is < 0 or >= Ev.Day) throw Ev.RuleFail("Invalid recurrence: original dates must be { date, minute: 0..1439 | null }");
        Date = date;
        Minute = minute;
    }

    /// <summary>The date.</summary>
    public GregorianDate Date { get; }

    /// <summary>0..1439, or null for the master's start minute.</summary>
    public int? Minute { get; }
}

/// <summary>A repeat: its rule, end, extra dates (<c>RDATE</c>) and removed dates (<c>EXDATE</c>). TS: <c>EventRecurrence</c>.</summary>
public sealed partial record EventRecurrence
{
    /// <summary>A recurrence of <paramref name="rule"/> with <paramref name="end"/> (default never) and no extra or removed dates.</summary>
    public EventRecurrence(RepeatRule rule, RepeatEnd? end = null, ValueList<ExtraDate>? extraDates = null, ValueList<OriginalDate>? exceptDates = null)
    {
        Rule = rule ?? throw new ArgumentNullException(nameof(rule));
        End = end ?? RepeatEnd.Never;
        ExtraDates = extraDates ?? ValueList<ExtraDate>.Empty;
        ExceptDates = exceptDates ?? ValueList<OriginalDate>.Empty;
    }

    /// <summary>The rule.</summary>
    public RepeatRule Rule { get; init; }

    /// <summary>The end (never for dates and foreign rules).</summary>
    public RepeatEnd End { get; init; }

    /// <summary>RDATEs not explained by the rule; kept, expanded and written back.</summary>
    public ValueList<ExtraDate> ExtraDates { get; init; }

    /// <summary>Original occurrences removed (EXDATE).</summary>
    public ValueList<OriginalDate> ExceptDates { get; init; }
}

/// <summary>A window of original dates, both ends inclusive. TS: <c>ExpansionWindow</c>.</summary>
public readonly record struct ExpansionWindow(GregorianDate From, GregorianDate To);

/// <summary>The result of <see cref="EventRecurrence.Expand"/>. TS: <c>Expansion</c>.</summary>
/// <param name="Occurrences">Ascending by date, then by minute (the master's time first), without duplicates.</param>
/// <param name="Truncated">The limit was reached, the calendar-time guard stopped a rule, or the rule can never match (§4.6 step 5).</param>
/// <param name="Unsupported">The rule cannot be expanded (§4.6 step 6): only the start, when the window holds it.</param>
public sealed record Expansion(ValueList<ExtraDate> Occurrences, bool Truncated, bool Unsupported);

/// <summary>Where an exception (an <c>EXDATE</c> or an override's original) goes; <see cref="To"/> null: dropped. TS: <c>ExceptionMap</c>.</summary>
public readonly record struct ExceptionMap(OriginalDate From, OriginalDate? To);

/// <summary>The change a "future events" split makes (§4.7). TS: the <c>change</c> argument of <c>splitRecurrence</c>.</summary>
/// <param name="Recurrence">The tail's repeat, or null when it became Never.</param>
/// <param name="Start">The tail's start date.</param>
/// <param name="RuleChanged"><c>false</c> when the user kept the repeat.</param>
public sealed record SplitChange(EventRecurrence? Recurrence, GregorianDate Start, bool RuleChanged);

/// <summary>The result of <see cref="EventRecurrence.Split"/> (§4.7). TS: <c>SplitResult</c>.</summary>
/// <param name="Head">The series before the split date; null when it is the first occurrence.</param>
/// <param name="Tail">The series from the split date; null for "Delete all future events" (and when the repeat becomes Never).</param>
/// <param name="Overrides">Every override original on or after the split date (except the edited occurrence's own), mapped into the tail.</param>
/// <param name="DroppedCount">Exceptions and extra dates on or after the split date that the tail does not keep.</param>
public sealed record SplitResult(EventRecurrence? Head, EventRecurrence? Tail, ValueList<ExceptionMap> Overrides, int DroppedCount)
{
    /// <summary><c>DroppedCount &gt; 0</c>.</summary>
    public bool Dropped => DroppedCount > 0;
}

/// <summary>Which stored rule an <see cref="UntilRewrite"/> names.</summary>
public enum StoredRuleKind
{
    /// <summary>An <c>RRULE</c> (<c>"rrule"</c>).</summary>
    RRule,
    /// <summary>An <c>EXRULE</c> (<c>"exrule"</c>).</summary>
    ExRule,
}

/// <summary>
/// One stored <c>RRULE</c> or <c>EXRULE</c> whose <c>UNTIL</c> a retime rewrites: its index in stored order and
/// its until end date. Platforms write <see cref="Until.Format"/> of it into that rule's <c>UNTIL=</c> only
/// (§4.7). TS: <c>UntilRewrite</c>.
/// </summary>
public readonly record struct UntilRewrite(StoredRuleKind Rule, int Index, GregorianDate EndDate);

/// <summary>An all-day toggle of a retime (§4.7).</summary>
public enum AllDayChange
{
    /// <summary><c>"to-all-day"</c>.</summary>
    ToAllDay,
    /// <summary><c>"to-timed"</c>.</summary>
    ToTimed,
}

/// <summary>The result of <see cref="EventRecurrence.Retime"/>. TS: the result of <c>retimeExceptions</c>.</summary>
public sealed record RetimeResult(EventRecurrence Recurrence, ValueList<ExceptionMap> Overrides, ValueList<UntilRewrite> Untils, int DroppedCount)
{
    /// <summary><c>DroppedCount &gt; 0</c>.</summary>
    public bool Dropped => DroppedCount > 0;
}

/// <summary>The section of a repeat picker row.</summary>
public enum RepeatPresetSection
{
    /// <summary><c>"never"</c>.</summary>
    Never,
    /// <summary><c>"gregorian"</c>.</summary>
    Gregorian,
    /// <summary><c>"thirteen"</c>.</summary>
    Thirteen,
}

/// <summary>What happened to the repeat when the start moved (the §2.11 table). TS: <c>RepeatChange</c>.</summary>
public enum RepeatChange
{
    /// <summary><c>"none"</c>: the recurrence is unchanged.</summary>
    None,
    /// <summary><c>"adapted"</c>.</summary>
    Adapted,
    /// <summary><c>"converted"</c>.</summary>
    Converted,
    /// <summary><c>"dropped"</c>: the repeat became Never.</summary>
    Dropped,
}

/// <summary>The result of <see cref="EventRecurrence.AdaptToStart"/>.</summary>
public sealed record AdaptedRecurrence(EventRecurrence? Recurrence, RepeatChange Change);

/// <summary>One stored rule as recognition reads it: the rule and its <c>UNTIL</c> in the event's zone (<see cref="Until.InZone"/>), or null.</summary>
public sealed record StoredRule(RRule RRule, LocalDateTime? Until);

/// <summary>What <see cref="Recognition.Of"/> reads, every value already in the event's zone (§4.5). TS: <c>RecognitionInput</c>.</summary>
public sealed record RecognitionInput
{
    /// <summary>The input.</summary>
    public RecognitionInput(
        LocalDateTime start,
        ValueList<StoredRule>? rrules = null,
        ValueList<StoredRule>? exrules = null,
        ValueList<ExtraDate>? rdates = null,
        ValueList<OriginalDate>? exdates = null,
        string? marker = null)
    {
        EventTime.AssertPlain(start, "recognition start");
        Start = start;
        RRules = rrules ?? ValueList<StoredRule>.Empty;
        ExRules = exrules ?? ValueList<StoredRule>.Empty;
        Rdates = rdates ?? ValueList<ExtraDate>.Empty;
        Exdates = exdates ?? ValueList<OriginalDate>.Empty;
        Marker = marker;
    }

    /// <summary>Minute 0 for all-day events.</summary>
    public LocalDateTime Start { get; }

    /// <summary>Each <c>RRULE</c> with its <c>UNTIL</c> in the event's zone.</summary>
    public ValueList<StoredRule> RRules { get; }

    /// <summary>Each <c>EXRULE</c>.</summary>
    public ValueList<StoredRule> ExRules { get; }

    /// <summary>The <c>RDATE</c>s.</summary>
    public ValueList<ExtraDate> Rdates { get; }

    /// <summary>The <c>EXDATE</c>s; minute null when it equals the start's minute or the value is a DATE.</summary>
    public ValueList<OriginalDate> Exdates { get; }

    /// <summary>The <c>X-THIRTEEN-RULE</c> value or the Android marker URI.</summary>
    public string? Marker { get; }
}

/// <summary>Where a recognized repeat came from (§4.5). TS: <c>Recognition['source']</c>.</summary>
public enum RecognitionSource
{
    /// <summary><c>"marker"</c>.</summary>
    Marker,
    /// <summary><c>"byyearday"</c>.</summary>
    ByYearDay,
    /// <summary><c>"leap-interval"</c>.</summary>
    LeapInterval,
    /// <summary><c>"gregorian"</c>.</summary>
    Gregorian,
    /// <summary><c>"rdates"</c>.</summary>
    Rdates,
    /// <summary><c>"dates"</c>.</summary>
    Dates,
    /// <summary><c>"foreign"</c>.</summary>
    Foreign,
}

/// <summary>Text forms of the recurrence enums.</summary>
public static class RecurrenceText
{
    /// <summary><c>"none"</c>, <c>"adapted"</c>, <c>"converted"</c> or <c>"dropped"</c>.</summary>
    public static string RawValue(this RepeatChange change) => change switch
    {
        RepeatChange.None => "none",
        RepeatChange.Adapted => "adapted",
        RepeatChange.Converted => "converted",
        _ => "dropped",
    };

    /// <summary>The TypeScript value of a source.</summary>
    public static string RawValue(this RecognitionSource source) => source switch
    {
        RecognitionSource.Marker => "marker",
        RecognitionSource.ByYearDay => "byyearday",
        RecognitionSource.LeapInterval => "leap-interval",
        RecognitionSource.Gregorian => "gregorian",
        RecognitionSource.Rdates => "rdates",
        RecognitionSource.Dates => "dates",
        _ => "foreign",
    };

    /// <summary><c>"never"</c>, <c>"gregorian"</c> or <c>"thirteen"</c>.</summary>
    public static string RawValue(this RepeatPresetSection section) => section switch
    {
        RepeatPresetSection.Never => "never",
        RepeatPresetSection.Gregorian => "gregorian",
        _ => "thirteen",
    };

    /// <summary><c>"rrule"</c> or <c>"exrule"</c>.</summary>
    public static string RawValue(this StoredRuleKind kind) => kind == StoredRuleKind.RRule ? "rrule" : "exrule";

    /// <summary><c>"to-all-day"</c> or <c>"to-timed"</c>.</summary>
    public static string RawValue(this AllDayChange change) => change == AllDayChange.ToAllDay ? "to-all-day" : "to-timed";
}
