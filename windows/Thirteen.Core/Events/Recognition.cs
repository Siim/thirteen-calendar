namespace Thirteen.Core.Events;

/// <summary>
/// Stored recurrence data turned back into a repeat (§4.5), mirroring the "Recognition" part of
/// packages/core/src/events/recurrence.ts. TS: <c>Recognition</c>, <c>recognizeRecurrence</c>.
/// </summary>
/// <param name="Recurrence">The repeat.</param>
/// <param name="Source">Which step recognized it.</param>
/// <param name="Editable"><c>false</c>: show "Keep: ..." and preserve the stored text.</param>
/// <param name="Alternatives">Other 13-month rules the same stored data means (§4.5 steps 2, 4 and 5).</param>
/// <param name="OpenEnded">Android: the marker URI says <c>end=never</c> (top-up allowed).</param>
/// <param name="Series">Android parts: the marker's series id.</param>
/// <param name="Part">Android parts: the marker's part number.</param>
public sealed record Recognition(
    EventRecurrence Recurrence,
    RecognitionSource Source,
    bool Editable,
    ValueList<ThirteenRule> Alternatives,
    bool OpenEnded,
    string? Series,
    int? Part)
{
    private static CalendarSystemId[] SystemsOrder(CalendarSystemId preferred) =>
        preferred == CalendarSystemId.Ifc ? [CalendarSystemId.Ifc, CalendarSystemId.Positivist] : [CalendarSystemId.Positivist, CalendarSystemId.Ifc];

    /// <summary>The 13-month rules a start can carry, preferred system first (§4.5 step 2).</summary>
    private static List<ThirteenRule> CandidatesFor(GregorianDate start, CalendarSystemId preferred)
    {
        ThirteenRuleKind[] kinds = [ThirteenRuleKind.Monthly, ThirteenRuleKind.Weekly, ThirteenRuleKind.Biweekly, ThirteenRuleKind.Yearly, ThirteenRuleKind.Intercalary];
        var output = new List<ThirteenRule>();
        foreach (var system in SystemsOrder(preferred))
        {
            foreach (var kind in kinds)
            {
                if (ThirteenRule.For(kind, start, system) is { } rule) output.Add(rule);
            }
        }
        return output;
    }

    private static RRule WithoutEnd(RRule rrule) => rrule with { Count = null, Until = null };

    /// <summary>
    /// The end of a stored rule (§4.5): COUNT, or the until end date of its UNTIL in the event's zone. An
    /// UNTIL the platform could not convert is read as written.
    /// </summary>
    private static RepeatEnd EndOf(RRule rrule, LocalDateTime? until, LocalDateTime start)
    {
        if (rrule.Count is { } count) return RepeatEnd.AfterCount(count);
        if (rrule.Until is null) return RepeatEnd.Never;
        var value = until ?? rrule.Until switch
        {
            RRuleUntil.DateUntil d => LocalDateTime.Unchecked(d.Date, Ev.Day),
            RRuleUntil.FloatingUntil f => f.Value,
            RRuleUntil.UtcUntil u => u.Value,
            _ => throw new InvalidOperationException(),
        };
        try
        {
            return RepeatEnd.Until(Until.EndDate(value, start.Minute));
        }
        catch (ThirteenException)
        {
            return RepeatEnd.Until(start.Date);
        }
    }

    /// <summary>A 13-month rule's end read back: an until on the leap-interval cap is the encoding of never (§4.3 c).</summary>
    private static RepeatEnd ThirteenEnd(ThirteenRule rule, GregorianDate start, RepeatEnd end)
    {
        if (end is not RepeatEnd.UntilEnd until) return end;
        var cap = rule.CapFrom(start);
        return cap is { } c && until.Date == c ? RepeatEnd.Never : end;
    }

    /// <summary><c>true</c> unless the rule is leap-only and the end reaches past its cap (§4.5 steps 1 and 3).</summary>
    private static bool WithinCap(ThirteenRule rule, GregorianDate start, RepeatEnd end)
    {
        if (rule.CapFrom(start) is not { } cap) return true;
        return end switch
        {
            RepeatEnd.CountEnd count => start.Year + 4L * (count.Count - 1) <= cap.Year,
            RepeatEnd.UntilEnd until => until.Date <= cap,
            _ => false,
        };
    }

    /// <summary><c>true</c> when an RRULE has nothing but the given parts (and COUNT, UNTIL, WKST).</summary>
    private static bool OnlyParts(RRule rrule, params string[] allowed)
    {
        bool Ok(string key, int count) => allowed.Contains(key) || count == 0;
        return Ok("bySecond", rrule.BySecond.Count) && Ok("byMinute", rrule.ByMinute.Count) && Ok("byHour", rrule.ByHour.Count)
            && Ok("byDay", rrule.ByDay.Count) && Ok("byMonthDay", rrule.ByMonthDay.Count) && Ok("byYearDay", rrule.ByYearDay.Count)
            && Ok("byWeekNo", rrule.ByWeekNo.Count) && Ok("byMonth", rrule.ByMonth.Count) && Ok("bySetPos", rrule.BySetPos.Count)
            && Ok("extensions", rrule.Extensions.Count) && rrule.Rscale is null && rrule.Skip is null;
    }

    /// <summary><c>true</c> when the Custom editor can express a single RRULE (§4.5 step 4, §2.13).</summary>
    private static bool Expressible(RRule rrule)
    {
        if (rrule.Interval > 99) return false;
        if (rrule.BySecond.Count + rrule.ByMinute.Count + rrule.ByHour.Count + rrule.ByYearDay.Count + rrule.ByWeekNo.Count > 0) return false;
        if ((rrule.Rscale is not null && rrule.Rscale != "GREGORIAN") || rrule.Skip is not null) return false;
        bool MonthDaysOk() => rrule.ByMonthDay.All(d => d > 0 || d == -1);
        switch (rrule.Freq)
        {
            case Frequency.Daily:
                return rrule.ByMonth.Count + rrule.ByMonthDay.Count + rrule.ByDay.Count + rrule.BySetPos.Count == 0;
            case Frequency.Weekly:
                return rrule.ByMonth.Count + rrule.ByMonthDay.Count + rrule.BySetPos.Count == 0 && RecurrenceTexts.PlainMask(rrule.ByDay) is not null;
            case Frequency.Monthly:
            case Frequency.Yearly:
                if (rrule.Freq == Frequency.Monthly && rrule.ByMonth.Count > 0) return false;
                if (rrule.Freq == Frequency.Yearly && rrule.ByMonth.Count == 0) return rrule.ByMonthDay.Count + rrule.ByDay.Count + rrule.BySetPos.Count == 0;
                if (rrule.ByDay.Count == 0 && rrule.BySetPos.Count == 0) return MonthDaysOk();
                return RecurrenceTexts.OnTheText(rrule) is not null;
            default:
                return false;
        }
    }

    /// <summary>The 13-month yearly rules whose encoding is the plain yearly rule (form a) for the start, preferred system first.</summary>
    private static List<ThirteenRule> InvariantYearly(GregorianDate start, CalendarSystemId preferred)
    {
        var output = new List<ThirteenRule>();
        foreach (var system in SystemsOrder(preferred))
        {
            var rule = ThirteenRule.For(ThirteenRuleKind.Yearly, start, system) ?? ThirteenRule.For(ThirteenRuleKind.Intercalary, start, system);
            if (rule is not null && rule.EncodingForm == ThirteenEncodingForm.GregorianYearly) output.Add(rule);
        }
        return output;
    }

    /// <summary>
    /// <c>true</c> when {start} plus the dates equals the rule's dates from the start through the latest of
    /// them (§4.5 steps 1 and 5); a leap-only rule's dates end at its cap.
    /// </summary>
    private static bool IsPrefix(ThirteenRule rule, GregorianDate start, IReadOnlyList<GregorianDate> dates)
    {
        var days = dates.Select(d => (long)d.JulianDayNumber).Prepend(start.JulianDayNumber).ToList();
        var latest = Ev.DateOf(days.Max());
        if (!WithinCap(rule, start, RepeatEnd.Until(latest))) return false;
        var expected = rule.DatesAfter(start, RepeatEnd.Until(latest), latest, long.MaxValue).Dates;
        return RRule.SameSet(days, expected.Select(d => (long)d.JulianDayNumber).Prepend(start.JulianDayNumber));
    }

    /// <summary>The marker's rule, Android extras and end, or null when it does not parse.</summary>
    private static (ThirteenRule Rule, RepeatEnd? End, string? Series, int? Part, bool Uri)? ReadMarker(string? marker)
    {
        if (marker is null) return null;
        try
        {
            if (marker.StartsWith("thirteen://", StringComparison.Ordinal))
            {
                var uri = ThirteenRule.ParseUri(marker);
                return (uri.Rule, uri.End, uri.Series, uri.Part, true);
            }
            return (ThirteenRule.ParseMarkerText(marker), null, null, null, false);
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    /// <summary>
    /// Turns stored recurrence data back into a repeat (§4.5). Values with the start's own minute are read as
    /// the master's (minute null) first. Steps, first match wins: 1. marker (trusted when its encoding equals
    /// the single RRULE, or with no rule when the dates are a prefix of its dates); 2. day-of-year list; 3. leap
    /// interval; 4. Gregorian (an RRULE the Custom editor can express); 5. date list (a rule made from the
    /// start, else <c>dates</c>); 6. anything else (several RRULEs or an EXRULE: foreign; one RRULE the editor
    /// cannot express: a Gregorian rule that is not editable). EXDATEs are always the excluded dates.
    /// TS: <c>recognizeRecurrence</c>.
    /// </summary>
    public static Recognition Of(RecognitionInput input, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        ArgumentNullException.ThrowIfNull(input);
        _ = system.Definition();
        foreach (var entry in input.RRules.Concat(input.ExRules)) entry.RRule.Validate("recognition rrule");
        var start = input.Start;
        var startDate = start.Date;
        int? MinuteOf(int? minute) => minute == start.Minute ? null : minute;
        var rdates = input.Rdates.Select(x => new ExtraDate(x.Date, MinuteOf(x.Minute), x.DurationMinutes)).ToValueList();
        var exdates = input.Exdates.Select(x => new OriginalDate(x.Date, MinuteOf(x.Minute))).ToValueList();

        Recognition Result(
            RepeatRule rule,
            RepeatEnd end,
            RecognitionSource source,
            bool editable,
            ValueList<ExtraDate>? extraDates = null,
            IEnumerable<ThirteenRule>? alternatives = null,
            bool openEnded = false,
            string? series = null,
            int? part = null)
        {
            var extras = extraDates ?? ValueList<ExtraDate>.Empty;
            return new Recognition(
                new EventRecurrence(rule, end, extras, exdates),
                source,
                editable && extras.Count == 0,
                (alternatives ?? []).ToValueList(),
                openEnded,
                series,
                part);
        }

        var single = input.RRules.Count == 1 && input.ExRules.Count == 0 ? input.RRules[0] : null;
        var plainDates = rdates.All(x => x.Minute is null && x.DurationMinutes is null) && exdates.All(x => x.Minute is null);

        // 1. Marker.
        if (ReadMarker(input.Marker) is { } marker)
        {
            var openEnded = marker.Uri && marker.End is RepeatEnd.NeverEnd;
            if (single is not null && marker.Rule.Includes(startDate, startDate))
            {
                var encoding = marker.Rule.Encode(startDate).RRule;
                var end = EndOf(single.RRule, single.Until, start);
                // A leap-only marker is trusted only with an end on or before its cap, as step 3 requires.
                if (encoding.IsEquivalentTo(single.RRule, true, true) && WithinCap(marker.Rule, startDate, end))
                {
                    return Result(RepeatRule.Of(marker.Rule), ThirteenEnd(marker.Rule, startDate, end), RecognitionSource.Marker, true,
                        rdates, null, openEnded, marker.Series, marker.Part);
                }
            }
            if (input.RRules.Count == 0 && input.ExRules.Count == 0 && plainDates)
            {
                var listed = rdates.Select(x => x.Date).Concat(exdates.Select(x => x.Date)).ToList();
                if (IsPrefix(marker.Rule, startDate, listed))
                {
                    var latest = Ev.DateOf(listed.Select(d => (long)d.JulianDayNumber).Append(startDate.JulianDayNumber).Max());
                    var end = marker.End ?? RepeatEnd.Until(latest);
                    return Result(RepeatRule.Of(marker.Rule), end, RecognitionSource.Marker, true, null, null, openEnded, marker.Series, marker.Part);
                }
            }
        }

        // 2. Day-of-year list.
        if (single is not null && rdates.Count == 0)
        {
            var rrule = single.RRule;
            if (rrule.Freq == Frequency.Yearly && rrule.Interval == 1 && rrule.ByYearDay.Count > 0 && OnlyParts(rrule, "byYearDay"))
            {
                var matches = CandidatesFor(startDate, system).Where(rule => rule.YearDayList(startDate) is { } list && RRule.SameSet(list, rrule.ByYearDay)).ToList();
                if (matches.Count > 0)
                {
                    return Result(RepeatRule.Of(matches[0]), EndOf(rrule, single.Until, start), RecognitionSource.ByYearDay, true, null, matches.Skip(1));
                }
            }
        }

        // 3. Leap interval.
        if (single is not null && rdates.Count == 0)
        {
            var rrule = single.RRule;
            if (rrule.Freq == Frequency.Yearly && rrule.Interval == 4 && OnlyParts(rrule))
            {
                var rule = SystemsOrder(system)
                    .Select(s => ThirteenRule.For(ThirteenRuleKind.Intercalary, startDate, s))
                    .FirstOrDefault(r => r is not null && r.EncodingForm == ThirteenEncodingForm.LeapInterval);
                if (rule is not null)
                {
                    var end = EndOf(rrule, single.Until, start);
                    if (WithinCap(rule, startDate, end)) return Result(RepeatRule.Of(rule), ThirteenEnd(rule, startDate, end), RecognitionSource.LeapInterval, true);
                }
            }
        }

        // 4. Gregorian.
        if (single is not null && Expressible(single.RRule))
        {
            var rrule = single.RRule;
            var plainYearly = rrule.Freq == Frequency.Yearly && rrule.Interval == 1 && OnlyParts(rrule, "byMonth", "byMonthDay", "extensions")
                && ((rrule.ByMonth.Count == 0 && rrule.ByMonthDay.Count == 0)
                    || (RecurrenceTexts.SameList(rrule.ByMonth, startDate.Month) && RecurrenceTexts.SameList(rrule.ByMonthDay, startDate.Day)));
            return Result(RepeatRule.Of(WithoutEnd(rrule)), EndOf(rrule, single.Until, start), RecognitionSource.Gregorian, true,
                rdates, plainYearly ? InvariantYearly(startDate, system) : null);
        }

        // 5. Date list.
        if (input.RRules.Count == 0 && input.ExRules.Count == 0 && rdates.Count > 0)
        {
            if (plainDates)
            {
                var listed = rdates.Select(x => x.Date).Concat(exdates.Select(x => x.Date)).ToList();
                var matches = CandidatesFor(startDate, system).Where(rule => IsPrefix(rule, startDate, listed)).ToList();
                if (matches.Count > 0)
                {
                    var latest = Ev.DateOf(listed.Select(d => (long)d.JulianDayNumber).Append(startDate.JulianDayNumber).Max());
                    return Result(RepeatRule.Of(matches[0]), RepeatEnd.Until(latest), RecognitionSource.Rdates, true, null, matches.Skip(1));
                }
            }
            return Result(RepeatRule.Dates, RepeatEnd.Never, RecognitionSource.Dates, false, rdates);
        }

        // 6. Anything else.
        if (single is not null)
        {
            return Result(RepeatRule.Of(WithoutEnd(single.RRule)), EndOf(single.RRule, single.Until, start), RecognitionSource.Gregorian, false, rdates);
        }
        if (input.RRules.Count == 0 && input.ExRules.Count == 0) return Result(RepeatRule.Dates, RepeatEnd.Never, RecognitionSource.Dates, false);
        EndedRule Ended(StoredRule entry) => new(WithoutEnd(entry.RRule), EndOf(entry.RRule, entry.Until, start));
        return Result(
            RepeatRule.Foreign(input.RRules.Select(Ended).ToValueList(), input.ExRules.Select(Ended).ToValueList()),
            RepeatEnd.Never,
            RecognitionSource.Foreign,
            false,
            rdates);
    }
}
