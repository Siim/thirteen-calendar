using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>
/// The changes a pending move or delete (§2.11) makes to one UID group of a stored document (§3.6, §4.4 "Windows and
/// web"): a single event is changed or removed; one occurrence of a repeating event gets an override with its
/// <c>RECURRENCE-ID</c> (a move) or an <c>EXDATE</c> (a delete); an override shown on its own (an orphan) is changed or
/// removed. Every changed component gets <c>SEQUENCE</c> + 1 and new <c>LAST-MODIFIED</c> and <c>DTSTAMP</c>, and is
/// re-serialized; the other members of the group keep their raw text. A change that no longer fits the stored group
/// (the event is gone, or its times changed elsewhere since the occurrence was read) throws
/// <see cref="EventStoreException"/> with <see cref="StoreFailure.Changed"/>.
/// </summary>
public static class EventEdits
{
    /// <summary>The first day an event can be moved or edited on (§3.5: earlier events keep Delete and their alerts).</summary>
    public static readonly GregorianDate FirstEditable = new(1583, 1, 1);

    /// <summary>A changed component: <c>SEQUENCE</c> + 1, <c>LAST-MODIFIED</c> and <c>DTSTAMP</c> now, re-serialized (§3.6).</summary>
    public static IcsEvent Touch(IcsEvent component, LocalDateTime nowUtc) => component with
    {
        Sequence = component.Sequence + 1,
        LastModified = new IcsDateValue.UtcValue(nowUtc),
        Dtstamp = new IcsDateValue.UtcValue(nowUtc),
        Raw = null,
    };

    /// <summary>
    /// The group without the occurrence: null (remove the group) for a single event or the last member, the master with
    /// the original date in <c>EXDATE</c> (and without its override) for an occurrence of a repeating event, the group
    /// without that override for an orphan.
    /// </summary>
    public static IcsGroup? DeleteOccurrence(IcsGroup? group, IcsExpandedEvent occurrence, LocalDateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        var (resolved, current) = Resolve(group, occurrence);
        group = resolved;
        if (occurrence.Orphan || group.Master is null)
        {
            var overrides = group.Overrides.Where(o => !ReferenceEquals(o, current)).ToValueList();
            return group.Master is null && overrides.Count == 0 ? null : group with { Overrides = overrides };
        }
        if (!occurrence.Recurring) return null;
        var master = group.Master;
        var original = OriginalValue(master, occurrence);
        // The override that shows the occurrence is the component the expansion returned (Resolve found it again): its
        // RECURRENCE-ID may name the instant in another form than DTSTART (UTC beside a TZID, RFC 5545 §3.8.4.4).
        var shown = ReferenceEquals(current, master) ? null : current;
        var remaining = group.Overrides.Where(o => !ReferenceEquals(o, shown) && (o.RecurrenceId is null || !SameInstant(o.RecurrenceId, original))).ToValueList();
        var exdates = master.Exdates.Any(x => SameInstant(x, original)) ? master.Exdates : master.Exdates.Append(original).ToValueList();
        return group with { Master = Touch(master with { Exdates = exdates }, nowUtc), Overrides = remaining };
    }

    /// <summary>
    /// The group with the occurrence at a new start and end of the device's wall clock (a drag, §2.4): converted to the
    /// component's own zone (§3.3) and form (dates for all-day events, §3.1.1). A single event or an orphan is changed in
    /// place; an occurrence of a repeating event gets an override for its original date (a copy of the master without
    /// its recurrence), or its existing override is changed. <paramref name="allDay"/> (task W6) turns a timed event
    /// all-day (dropped on the all-day row of Week or Day) or an all-day one timed in the device's zone (dropped on the
    /// timeline, §2.5); null keeps the occurrence's own setting.
    /// </summary>
    public static IcsGroup MoveOccurrence(
        IcsCalendar calendar,
        IcsGroup? group,
        IcsExpandedEvent occurrence,
        LocalDateTime newStart,
        LocalDateTime newEnd,
        string deviceZone,
        IZoneResolver zones,
        LocalDateTime nowUtc,
        bool? allDay = null)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        ArgumentNullException.ThrowIfNull(occurrence);
        if (newEnd.CompareTo(newStart) < 0) throw new ArgumentException("The end is before the start", nameof(newEnd));
        var (resolved, current) = Resolve(group, occurrence);
        group = resolved;
        // A backstop for the views (§3.5): an event of a series or single event before 1583 is never moved.
        if ((group.Master ?? current).Start.DateOf < FirstEditable || current.Start.DateOf < FirstEditable)
        {
            throw new EventStoreException(StoreFailure.ReadOnly, "Events before 1583 can only be deleted or get new alerts.");
        }
        var targetAllDay = allDay ?? occurrence.AllDay;
        if (occurrence.Orphan || (ReferenceEquals(current, group.Master) && !occurrence.Recurring) || group.Master is null)
        {
            var moved = Touch(Retime(calendar, current, targetAllDay, newStart, newEnd, deviceZone, zones), nowUtc);
            return ReferenceEquals(current, group.Master)
                ? group with { Master = moved }
                : group with { Overrides = group.Overrides.Select(o => ReferenceEquals(o, current) ? moved : o).ToValueList() };
        }
        var master = group.Master;
        var original = OriginalValue(master, occurrence);
        // The override the occurrence shows (found by the expansion, whatever form its RECURRENCE-ID has), else one for
        // its original date in DTSTART's form.
        var existing = !ReferenceEquals(current, master)
            ? current
            : group.Overrides.FirstOrDefault(o => o.RecurrenceId is not null && SameInstant(o.RecurrenceId, original));
        if (existing is not null)
        {
            var moved = Touch(Retime(calendar, existing, targetAllDay, newStart, newEnd, deviceZone, zones), nowUtc);
            return group with { Overrides = group.Overrides.Select(o => ReferenceEquals(o, existing) ? moved : o).ToValueList() };
        }
        var copy = master with
        {
            RecurrenceId = original,
            RRules = ValueList<RRule>.Empty,
            ExRules = ValueList<RRule>.Empty,
            Rdates = ValueList<IcsRdate>.Empty,
            Exdates = ValueList<IcsDateValue>.Empty,
            ThirteenRule = null,
            ImportedLastModified = null,
            Raw = null,
            Original = null,
            Line = null,
            Created = new IcsDateValue.UtcValue(nowUtc),
        };
        var created = Touch(Retime(calendar, copy, targetAllDay, newStart, newEnd, deviceZone, zones), nowUtc);
        return group with { Overrides = group.Overrides.Append(created).ToValueList() };
    }

    /// <summary>
    /// The stored component that shows the occurrence: its override, else the master. Throws
    /// <see cref="StoreFailure.Changed"/> when the group is gone or the component's times changed since the
    /// occurrence was read (§2.11 "the time group of a moved event changed elsewhere").
    /// </summary>
    private static (IcsGroup Group, IcsEvent Current) Resolve(IcsGroup? group, IcsExpandedEvent occurrence)
    {
        if (group is null) throw Changed(occurrence, "its event is gone");
        var shown = occurrence.Component;
        IcsEvent? current = shown.RecurrenceId is null
            ? group.Master
            : group.Overrides.FirstOrDefault(o => o.RecurrenceId is not null && SameInstant(o.RecurrenceId, shown.RecurrenceId));
        if (current is null) throw Changed(occurrence, "its component is gone");
        if (!Equals(current.Start, shown.Start) || !Equals(current.End, shown.End) || current.Duration != shown.Duration
            || !current.RRules.Equals(shown.RRules) || !current.Rdates.Equals(shown.Rdates) || !current.Exdates.Equals(shown.Exdates))
        {
            throw Changed(occurrence, "its times changed since it was read");
        }
        return (group, current);
    }

    private static EventStoreException Changed(IcsExpandedEvent occurrence, string why) =>
        new(StoreFailure.Changed, $"Occurrence {occurrence.Key} no longer resolves: {why}");

    /// <summary>The occurrence's original start as a <c>RECURRENCE-ID</c> or <c>EXDATE</c> value in the form of the master's <c>DTSTART</c>.</summary>
    public static IcsDateValue OriginalValue(IcsEvent master, IcsExpandedEvent occurrence)
    {
        ArgumentNullException.ThrowIfNull(master);
        ArgumentNullException.ThrowIfNull(occurrence);
        var date = occurrence.OriginalDate;
        return master.Start switch
        {
            IcsDateValue.DateValue => new IcsDateValue.DateValue(date),
            IcsDateValue.ZonedValue z => new IcsDateValue.ZonedValue(new LocalDateTime(date, occurrence.OriginalMinute ?? z.Value.Minute), z.Tzid),
            IcsDateValue.UtcValue u => new IcsDateValue.UtcValue(new LocalDateTime(date, occurrence.OriginalMinute ?? u.Value.Minute)),
            IcsDateValue.FloatingValue f => new IcsDateValue.FloatingValue(new LocalDateTime(date, occurrence.OriginalMinute ?? f.Value.Minute)),
            _ => throw new ArgumentException("Unknown DTSTART form", nameof(master)),
        };
    }

    /// <summary>Two date values name the same original occurrence (same date, and same wall clock for date-times).</summary>
    private static bool SameInstant(IcsDateValue a, IcsDateValue b) => (a, b) switch
    {
        (IcsDateValue.DateValue x, _) => x.Date == b.DateOf,
        (_, IcsDateValue.DateValue y) => a.DateOf == y.Date,
        (IcsDateValue.ZonedValue x, IcsDateValue.ZonedValue y) => x.Value.CompareTo(y.Value) == 0,
        (IcsDateValue.UtcValue x, IcsDateValue.UtcValue y) => x.Value.CompareTo(y.Value) == 0,
        (IcsDateValue.FloatingValue x, IcsDateValue.FloatingValue y) => x.Value.CompareTo(y.Value) == 0,
        _ => Equals(a, b),
    };

    /// <summary>
    /// A component at new device times, in its own zone and form; <paramref name="allDay"/> true gives dates, and an
    /// all-day component made timed takes the device's zone (a <c>TZID</c> the document already defines for it, or the
    /// zone's id).
    /// </summary>
    private static IcsEvent Retime(IcsCalendar calendar, IcsEvent component, bool allDay, LocalDateTime newStart, LocalDateTime newEnd, string deviceZone, IZoneResolver zones)
    {
        if (!allDay && component.Start is IcsDateValue.DateValue)
        {
            var tzid = calendar.TimeZones.FirstOrDefault(t => IcsZones.Resolve(t.Tzid, calendar, zones) is { Zone: { } z } && z == deviceZone)?.Tzid ?? deviceZone;
            return component with
            {
                Start = new IcsDateValue.ZonedValue(Plain(newStart), tzid),
                End = new IcsDateValue.ZonedValue(Plain(newEnd), tzid),
                Duration = null,
            };
        }
        if (allDay)
        {
            var first = newStart.Date;
            var last = newEnd.IsEndOfDay ? newEnd.Date : newEnd.Minute == 0 && newEnd.CompareTo(newStart) > 0 ? newEnd.Date.AddDays(-1) : newEnd.Date;
            if (last.CompareTo(first) < 0) last = first;
            var end = IcsGroups.AllDayEnd(first, last);
            return component with { Start = new IcsDateValue.DateValue(first), End = end.End, Duration = end.Duration };
        }
        IcsDateValue Convert(IcsDateValue form, LocalDateTime device)
        {
            switch (form)
            {
                case IcsDateValue.FloatingValue:
                    // Floating times are read in the device's zone, so they are its wall clock.
                    return new IcsDateValue.FloatingValue(Plain(device));
                case IcsDateValue.UtcValue:
                    return new IcsDateValue.UtcValue(Plain(ZoneMath.ToUtc(Plain(device), deviceZone, zones) ?? throw OutOfRange()));
                case IcsDateValue.ZonedValue z:
                {
                    var handle = IcsZones.Resolve(z.Tzid, calendar, zones);
                    var utc = ZoneMath.ToUtc(Plain(device), deviceZone, zones) ?? throw OutOfRange();
                    if (handle.Resolver is null) return new IcsDateValue.ZonedValue(Plain(device), z.Tzid);
                    var wall = ZoneMath.ToZoned(utc, handle.Zone ?? handle.Tzid, handle.Resolver) ?? throw OutOfRange();
                    return new IcsDateValue.ZonedValue(wall, z.Tzid);
                }
                default:
                    throw new ArgumentException("A timed component needs a date-time start", nameof(component));
            }
        }
        var start = Convert(component.Start, newStart);
        var endForm = component.End ?? component.Start;
        var endValue = Convert(endForm is IcsDateValue.DateValue ? component.Start : endForm, newEnd);
        return component with { Start = start, End = endValue, Duration = null };
    }

    /// <summary>A value with minute 0..1439 (an end at 24:00 becomes 00:00 of the next day).</summary>
    private static LocalDateTime Plain(LocalDateTime value) => value.IsEndOfDay ? new LocalDateTime(value.Date.AddDays(1), 0) : value;

    private static EventStoreException OutOfRange() => new(StoreFailure.Changed, "The new time leaves years 1 to 9999");
}
