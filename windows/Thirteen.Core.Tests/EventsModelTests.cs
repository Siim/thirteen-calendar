using System.Text.Json;
using Thirteen.Core.Events;
using Thirteen.Core.Tests.Support;

namespace Thirteen.Core.Tests;

/// <summary>
/// The parts of the events API that fixtures/events.json does not replay directly (moveDraftStart,
/// setDraftAllDay, changedFields, describeAlarm, alarmFireTime, matchRepeatPreset, the TimeZoneInfo
/// resolver). Expectations are copied from packages/core/test/events/model.test.ts and recurrence.test.ts.
/// </summary>
public sealed class EventsModelTests
{
    private static LocalDateTime L(string text) => LocalDateTime.Parse(text);

    private static GregorianDate G(string text) => GregorianDate.ParseIso(text);

    private static readonly CalendarInfo Home = new("home", "Home", "#ea580c", "icloud", "iCloud", CalendarAccountKind.ICloud, true, ThirteenRepeats.All, null, true, true, true);

    private static readonly CalendarInfo Exchange = Home with
    {
        Id = "work",
        Title = "Work",
        AccountId = "exchange",
        AccountTitle = "Exchange",
        AccountKind = CalendarAccountKind.Exchange,
        ThirteenRepeats = ThirteenRepeats.GregorianOnly,
        MaxAlarms = 1,
        IsPlatformDefault = false,
    };

    private static EventRecurrence Thirteen(ThirteenRule rule) => new(RepeatRule.Of(rule));

    /// <summary>Book club: Cotsworth (§6.7), Monday 2026-10-19 = IFC Thursday October 12, 19:00 to 21:00.</summary>
    private static readonly EventDraft BookClub = new()
    {
        Title = "Book club: Cotsworth",
        Location = "Raamatukoi",
        AllDay = false,
        Start = L("2026-10-19T19:00"),
        End = L("2026-10-19T21:00"),
        TimeZone = "Europe/Tallinn",
        CalendarId = "home",
        Recurrence = Thirteen(new ThirteenRule.Monthly(CalendarSystemId.Ifc, 12)),
        Alarms = [Alarm.Relative(-60)],
        Availability = Availability.Busy,
    };

    private static readonly EventDraft Single = BookClub with { Recurrence = null };

    private static readonly EventDraft AllDay = Single with
    {
        Title = "Autumn school break",
        AllDay = true,
        Start = L("2026-10-19T00:00"),
        End = L("2026-10-25T24:00"),
        TimeZone = null,
        Alarms = [],
        Availability = Availability.Free,
    };

    private static EventDraft Timed(string start, string end) => Single with { Start = L(start), End = L(end) };

    // ---- moveDraftStart ------------------------------------------------------------------------

    [Fact]
    public void MoveStart_KeepsTheWallClockDuration_AndEveryOtherField()
    {
        var (draft, change) = Drafts.MoveStart(Single, L("2026-10-21T14:30"));
        Assert.Equal((L("2026-10-21T14:30"), L("2026-10-21T16:30")), (draft.Start, draft.End));
        Assert.Equal(RepeatChange.None, change);
        Assert.Equal(Single, draft with { Start = Single.Start, End = Single.End });
    }

    [Fact]
    public void MoveStart_WritesMidnightInEndOfDayForm_KeepsAllDayDays_AndStopsAtTheRangeEnd()
    {
        Assert.Equal("2026-10-19T24:00", Drafts.MoveStart(Single, L("2026-10-19T22:00")).Draft.End.ToString());
        Assert.Equal("2027-01-01T02:30", Drafts.MoveStart(Timed("2026-10-19T22:00", "2026-10-20T01:30"), L("2026-12-31T23:00")).Draft.End.ToString());
        var moved = Drafts.MoveStart(AllDay, L("2026-12-28T00:00")).Draft;
        Assert.Equal(("2026-12-28T00:00", "2027-01-03T24:00"), (moved.Start.ToString(), moved.End.ToString()));
        Assert.Throws<ThirteenException>(() => Drafts.MoveStart(AllDay, L("2026-12-28T09:00")));
        Assert.Equal("9999-12-31T24:00", Drafts.MoveStart(AllDay, L("9999-12-29T00:00")).Draft.End.ToString());
        var late = Drafts.MoveStart(Single, L("9999-12-31T23:00")).Draft;
        Assert.Equal("9999-12-31T24:00", late.End.ToString());
        Assert.Equal([DraftIssue.OutOfRange], Drafts.Validate(late, Home));
        Assert.Throws<ThirteenException>(() => Drafts.MoveStart(Single, L("2026-10-19T24:00")));
    }

    [Fact]
    public void MoveStart_AdaptsTheRepeat_AndTheDragCheckOfExchange()
    {
        Assert.Equal(RepeatChange.None, Drafts.MoveStart(BookClub, L("2026-11-16T19:00")).RepeatChange);
        var adapted = Drafts.MoveStart(BookClub, L("2026-10-20T19:00"));
        Assert.Equal(RepeatChange.Adapted, adapted.RepeatChange);
        Assert.Equal(RepeatRule.Of(new ThirteenRule.Monthly(CalendarSystemId.Ifc, 13)), adapted.Draft.Recurrence?.Rule);
        Assert.Empty(Drafts.Validate(adapted.Draft, Home));
        var dropped = Drafts.MoveStart(BookClub, L("2026-12-31T19:00"));
        Assert.Equal(RepeatChange.Dropped, dropped.RepeatChange);
        Assert.Null(dropped.Draft.Recurrence);

        var march3 = Timed("2026-02-28T19:00", "2026-02-28T21:00") with { Recurrence = Thirteen(new ThirteenRule.Yearly(CalendarSystemId.Ifc, 3, 3)) };
        Assert.Empty(Drafts.Validate(march3, Exchange));
        var (draft, change) = Drafts.MoveStart(march3, L("2026-03-01T19:00"));
        Assert.Equal(RepeatChange.Adapted, change);
        Assert.Equal(RepeatRule.Of(new ThirteenRule.Yearly(CalendarSystemId.Ifc, 3, 4)), draft.Recurrence?.Rule);
        Assert.Equal([DraftIssue.ThirteenRepeatNotAllowed], Drafts.Validate(draft, Exchange));
    }

    // ---- setDraftAllDay --------------------------------------------------------------------------

    [Fact]
    public void SetAllDay_On_KeepsTheCoveredDates_DropsTimesAndZone_AndSetsFree()
    {
        var on = Drafts.SetAllDay(Timed("2026-10-19T22:00", "2026-10-20T01:30"), true);
        Assert.Equal(("2026-10-19T00:00", "2026-10-20T24:00", (string?)null, Availability.Free, true), (on.Start.ToString(), on.End.ToString(), on.TimeZone, on.Availability, on.AllDay));
        Assert.Equal("2026-10-19T24:00", Drafts.SetAllDay(Timed("2026-10-19T23:00", "2026-10-19T24:00"), true).End.ToString());
        Assert.Equal("2026-10-19T24:00", Drafts.SetAllDay(Timed("2026-10-19T00:00", "2026-10-19T00:00"), true).End.ToString());
        Assert.Equal("2026-10-21T24:00", Drafts.SetAllDay(Timed("2026-10-19T10:00", "2026-10-22T00:00"), true).End.ToString());
        Assert.Empty(Drafts.Validate(on, Home));
        Assert.Equal(Availability.Busy, Drafts.SetAllDay(Single, true, availabilityTouched: true).Availability);
        Assert.Equal(Availability.Free, Drafts.SetAllDay(AllDay, false, availabilityTouched: true).Availability);
        Assert.Null(Drafts.SetAllDay(Timed("2026-10-19T10:00", "2026-10-19T11:00"), true, timeZone: "Europe/Tallinn").TimeZone);
    }

    [Fact]
    public void SetAllDay_Off_RestoresTheLastTimesOr0900To1000_Busy_FloatingUnlessAZoneIsGiven()
    {
        var off = Drafts.SetAllDay(AllDay, false);
        Assert.Equal(("2026-10-19T09:00", "2026-10-25T10:00", (string?)null, Availability.Busy), (off.Start.ToString(), off.End.ToString(), off.TimeZone, off.Availability));
        var single = AllDay with { End = L("2026-10-19T24:00") };
        var restored = Drafts.SetAllDay(single, false, new PreviousTimes(19 * 60, 21 * 60));
        Assert.Equal(("2026-10-19T19:00", "2026-10-19T21:00"), (restored.Start.ToString(), restored.End.ToString()));
        var overnight = Drafts.SetAllDay(single, false, new PreviousTimes(22 * 60, 90));
        Assert.Equal(("2026-10-19T22:00", "2026-10-20T01:30"), (overnight.Start.ToString(), overnight.End.ToString()));
        var midnight = Drafts.SetAllDay(single, false, new PreviousTimes(23 * 60, 1440));
        Assert.Equal(("2026-10-19T23:00", "2026-10-19T24:00"), (midnight.Start.ToString(), midnight.End.ToString()));
        var created = Drafts.New(G("2026-10-19"), L("2026-10-19T10:20"), "home", allDay: true, timeZone: "Europe/Tallinn");
        Assert.Null(created.TimeZone);
        Assert.Equal("Europe/Tallinn", Drafts.SetAllDay(created, false, timeZone: "Europe/Tallinn").TimeZone);
        Assert.Null(Drafts.SetAllDay(created, false).TimeZone);
        Assert.Throws<ThirteenException>(() => Drafts.SetAllDay(AllDay, false, new PreviousTimes(1440, 1440)));
        Assert.Throws<ThirteenException>(() => Drafts.SetAllDay(AllDay, false, new PreviousTimes(0, 1441)));
        Assert.Throws<ThirteenException>(() => Drafts.SetAllDay(AllDay, false, timeZone: ""));
    }

    [Fact]
    public void SetAllDay_RoundTripsATimedEvent_AndKeepsRepeatAndAlerts()
    {
        var original = Timed("2026-10-19T22:00", "2026-10-20T01:30");
        var back = Drafts.SetAllDay(Drafts.SetAllDay(original, true), false, new PreviousTimes(22 * 60, 90), timeZone: original.TimeZone);
        Assert.Equal(original, back);
        Assert.Empty(DraftMerge.ChangedFields(original, back));
        var fresh = Drafts.New(G("2026-10-19"), L("2026-10-19T10:20"), "home", timeZone: "Europe/Tallinn");
        var toggled = Drafts.SetAllDay(Drafts.SetAllDay(fresh, true), false, new PreviousTimes(660, 720), timeZone: fresh.TimeZone);
        Assert.Empty(DraftMerge.ChangedFields(fresh, toggled));
        Assert.Equal("Europe/Tallinn", toggled.TimeZone);
        Assert.Equal(BookClub.Recurrence, Drafts.SetAllDay(BookClub, true).Recurrence);
        Assert.Equal(BookClub.Alarms, Drafts.SetAllDay(BookClub, true).Alarms);
        Assert.Equal(BookClub, Drafts.SetAllDay(BookClub, false));
    }

    // ---- changedFields and mergeDraft --------------------------------------------------------------

    [Fact]
    public void ChangedFields_InFieldOrder_TimeComparesMoments()
    {
        Assert.Empty(DraftMerge.ChangedFields(BookClub, BookClub));
        Assert.Equal(
            [DraftField.Title, DraftField.Time, DraftField.Availability],
            DraftMerge.ChangedFields(BookClub, BookClub with { Availability = Availability.Free, Title = "X", End = L("2026-10-19T22:00") }));
        var midnight = Timed("2026-10-19T23:00", "2026-10-19T24:00");
        Assert.Empty(DraftMerge.ChangedFields(midnight, midnight with { End = L("2026-10-20T00:00") }));
        Assert.Equal([DraftField.Time], DraftMerge.ChangedFields(BookClub, BookClub with { TimeZone = "UTC" }));
        Assert.Equal([DraftField.Calendar], DraftMerge.ChangedFields(BookClub, BookClub with { CalendarId = "work" }));
        Assert.Equal([DraftField.Recurrence], DraftMerge.ChangedFields(BookClub, BookClub with { Recurrence = null }));
        Assert.Equal(
            [DraftField.Recurrence],
            DraftMerge.ChangedFields(BookClub, BookClub with { Recurrence = BookClub.Recurrence! with { ExceptDates = [new OriginalDate(G("2026-11-16"))] } }));
        ValueList<Alarm> two = [Alarm.Relative(-60), Alarm.Relative(-15)];
        Assert.Equal([DraftField.Alarms], DraftMerge.ChangedFields(BookClub with { Alarms = two }, BookClub with { Alarms = [.. two.Reverse()] }));
    }

    [Fact]
    public void Merge_TakesWrittenGroupsFromEdited_AndTheRestFromCurrent()
    {
        var edited = BookClub with { Title = "Book club (moved)", Start = L("2026-10-19T20:00"), End = L("2026-10-19T22:00") };
        var current = BookClub with { Notes = "Bring the pamphlet.", Title = "Book club: Cotsworth and Comte" };
        var result = DraftMerge.Merge(BookClub, edited, current);
        Assert.Equal([DraftField.Title, DraftField.Time], result.Written);
        Assert.Equal([DraftField.Title], result.Conflicts);
        Assert.Equal(edited with { Notes = "Bring the pamphlet." }, result.Merged);
        var change = BookClub with { Location = "Rahva Raamat" };
        Assert.Equal(new MergeResult(change, [DraftField.Location], []), DraftMerge.Merge(BookClub, change, change));
    }

    [Fact]
    public void ApplyToSeries_KeepsTheMasterDate_AndTakesTheStartMinuteLengthAndZone()
    {
        var master = Timed("2026-01-05T19:00", "2026-01-05T20:00") with { Recurrence = BookClub.Recurrence };
        var opened = Timed("2026-10-19T19:00", "2026-10-19T20:00") with { Recurrence = BookClub.Recurrence };
        var result = DraftMerge.ApplyToSeries(master, opened, opened with { Start = L("2026-10-19T08:15"), End = L("2026-10-19T10:00"), TimeZone = "UTC" }, null);
        Assert.Equal(
            new SeriesEdit(master with { Start = L("2026-01-05T08:15"), End = L("2026-01-05T10:00"), TimeZone = "UTC" }, null, [DraftField.Time], new SeriesRetime(-645, null)),
            result);
        Assert.Equal(new SeriesEdit(master, null, [], null), DraftMerge.ApplyToSeries(master, opened, opened, null));
    }

    // ---- Alarms ------------------------------------------------------------------------------------

    [Fact]
    public void DescribeAlarm_AlertsThatMatchNoPreset_AndAbsoluteAlerts()
    {
        Assert.Equal("45 minutes before", Alarm.Relative(-45).Describe(false));
        Assert.Equal("1 minute before", Alarm.Relative(-1).Describe(false));
        Assert.Equal("90 minutes before", Alarm.Relative(-90).Describe(false));
        Assert.Equal("3 hours before", Alarm.Relative(-180).Describe(false));
        Assert.Equal("14 days before", Alarm.Relative(-20160).Describe(false));
        Assert.Equal("10 minutes after", Alarm.Relative(10).Describe(false));
        Assert.Equal("1 minute after", Alarm.Relative(1).Describe(false));
        Assert.Equal("1 day before at 23:45", Alarm.Relative(-15).Describe(true));
        Assert.Equal("3 days before at 18:30", Alarm.Relative(-1440 * 3 + 1110).Describe(true));
        Assert.Equal("On the day at 00:00", Alarm.Relative(0).Describe(true));
        Assert.Equal("On the day at 12:00 AM", Alarm.Relative(0).Describe(true, use24Hour: false));
        Assert.Equal("On the day at 12:00 PM", Alarm.Relative(720).Describe(true, use24Hour: false));
        Assert.Equal("1500 minutes after", Alarm.Relative(1500).Describe(true));
        Assert.Equal("At 08:00 on Thursday, October 12, 2026", Alarm.Absolute(L("2026-10-19T08:00")).Describe(false));
        Assert.Equal("At 08:00 on Friday, Descartes 12, 238", Alarm.Absolute(L("2026-10-19T08:00")).Describe(true, CalendarSystemId.Positivist));
        Assert.Equal("At 8:15 PM on Year Day 2026", Alarm.Absolute(L("2026-12-31T20:15")).Describe(false, use24Hour: false));
        for (var offset = -20000; offset <= 2000; offset += 37)
        {
            Assert.DoesNotMatch("[\u2013\u2014]", Alarm.Relative(offset).Describe(false));
            Assert.DoesNotMatch("[\u2013\u2014]", Alarm.Relative(offset).Describe(true, use24Hour: false));
        }
    }

    [Fact]
    public void AlarmFireTime_ThroughASyntheticZone_AndItsValidation()
    {
        using var doc = JsonDocument.Parse("""{"name":"Test/Plus2","offset":120,"transitions":[]}""");
        var synthetic = new SyntheticZoneResolver(doc.RootElement);
        Assert.Equal("2026-10-19T07:00", Alarm.FireTime(Alarm.Relative(540), true, L("2026-10-19T00:00"), null, "Test/Plus2", synthetic)?.ToString());
        var zones = TimeZoneInfoZoneResolver.Shared;
        Assert.Throws<ThirteenException>(() => Alarm.FireTime(Alarm.Relative(0), false, L("2026-10-19T19:00"), null, "UTC", zones));
        Assert.Throws<ThirteenException>(() => Alarm.FireTime(Alarm.Relative(0), true, L("2026-10-19T09:00"), null, "UTC", zones));
        Assert.Throws<ThirteenException>(() => Alarm.FireTime(Alarm.Relative(0), true, L("2026-10-19T00:00"), null, "Mars/Olympus", zones));
        Assert.Null(Alarm.FireTime(Alarm.Relative(60), false, L("9999-12-31T23:30"), L("9999-12-31T23:30"), "UTC", zones));
    }

    // ---- Presets ---------------------------------------------------------------------------------

    [Fact]
    public void RepeatPresetMatch_FindsThePresetOfARecurrence()
    {
        var start = G("2026-10-19");
        EventRecurrence Rr(string rule) => new(RepeatRule.Of(RRule.Parse(rule)));
        var ifc12 = Thirteen(new ThirteenRule.Monthly(CalendarSystemId.Ifc, 12));
        Assert.Equal("never", RepeatPreset.Match(null, start));
        Assert.Equal("weekly", RepeatPreset.Match(Rr("FREQ=WEEKLY"), start));
        Assert.Equal("weekly", RepeatPreset.Match(Rr("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=SU"), start));
        Assert.Equal("biweekly", RepeatPreset.Match(Rr("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"), start));
        Assert.Equal("monthly", RepeatPreset.Match(Rr("FREQ=MONTHLY;BYMONTHDAY=19"), start));
        Assert.Equal("yearly", RepeatPreset.Match(Rr("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=19"), start));
        Assert.Null(RepeatPreset.Match(Rr("FREQ=WEEKLY;BYDAY=TU"), start));
        Assert.Equal("weekly", RepeatPreset.Match(Rr("FREQ=WEEKLY") with { End = RepeatEnd.AfterCount(3) }, start));
        Assert.Equal("thirteen-monthly", RepeatPreset.Match(ifc12, start));
        Assert.Null(RepeatPreset.Match(ifc12, start, CalendarSystemId.Positivist));
        Assert.Null(RepeatPreset.Match(Rr("FREQ=WEEKLY") with { ExtraDates = [new ExtraDate(G("2026-10-21"))] }, start));
    }

    // ---- TimeZoneInfo resolver -------------------------------------------------------------------

    [Fact]
    public void TimeZoneInfoResolver_KnowsIanaIdsAndUtc_RejectsWindowsIdsAndUnknownZones()
    {
        var zones = TimeZoneInfoZoneResolver.Shared;
        Assert.True(zones.IsKnown("UTC"));
        Assert.True(zones.IsKnown("Europe/Tallinn"));
        Assert.False(zones.IsKnown("Mars/Olympus"));
        Assert.False(zones.IsKnown("FLE Standard Time"));
        Assert.Equal(180, zones.OffsetMinutesAt("Europe/Tallinn", L("2026-07-01T00:00")));
        Assert.Equal(120, zones.OffsetMinutesAt("Europe/Tallinn", L("2026-12-01T00:00")));
        Assert.Equal(345, zones.OffsetMinutesAt("Asia/Kathmandu", L("2026-10-19T06:15")));
        Assert.Equal("2026-10-19T16:00", ZoneMath.ToUtc(L("2026-10-19T19:00"), "Europe/Tallinn", zones)?.ToString());
        Assert.Equal("2026-10-19T19:00", ZoneMath.ToZoned(L("2026-10-19T16:00"), "Europe/Tallinn", zones)?.ToString());
        Assert.Throws<ThirteenException>(() => ZoneMath.ToUtc(L("2026-10-19T19:00"), "Mars/Olympus", zones));
    }
}
