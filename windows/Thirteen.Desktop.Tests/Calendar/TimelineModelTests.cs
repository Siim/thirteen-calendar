using Avalonia.Headless.XUnit;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Tests.Events;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests.CalendarSection;

/// <summary>
/// Week and Day (docs/EVENTS.md §2.5, §2.6) and drag edits (§2.11 "Drag edits", task W6) on the mockup data set (§6.7,
/// today Monday, October 19, 2026 = IFC Thursday, October 12, now 09:41 in Europe/Tallinn): the columns and their
/// accessible names, <c>maxSlots</c> and the "+{n}" blocks, the scroll target, the now line, the all-day row; a drop
/// validated, planned (held at once, the span question with the repeat change and the losses, only "this event" for
/// repeats set in another app), held as a pending change and shown at once, undone, or written for future events.
/// </summary>
public class TimelineModelTests
{
    private static readonly LocalDateTime Day19 = LocalDateTime.Parse("2026-10-19T00:00");

    internal static (TestShell Shell, CalendarViewModel Calendar, FakeEventStore Store, PendingChanges Pending) Mockup()
    {
        var shell = new TestShell(TestShell.October19);
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var pending = new PendingChanges(store, store.Clock);
        shell.Model.AttachEvents(new EventsModel(store, pending: pending, post: action => action()));
        shell.Model.Section = AppSection.Calendar;
        return (shell, shell.Model.CalendarPage, store, pending);
    }

    private static CalendarItem Item(CalendarViewModel calendar, string date, string title) =>
        calendar.Events!.Items(Day(date), Day(date)).First(i => i.Title == title);

    private static async Task<(FakeEventStore Store, ResolvedEvent Resolved)> Resolve(string date, string title, FakeEventStore? existing = null)
    {
        var store = existing ?? new FakeEventStore();
        if (existing is null) await store.LoadAsync();
        var day = LocalDateTime.Parse(date + "T00:00");
        var occurrence = store.Occurrences(day, day.AddMinutes(1440)).First(o => o.Title == title);
        return (store, EventMoves.Resolve(store, occurrence)!);
    }

    private static MovePlan Plan(FakeEventStore store, ResolvedEvent resolved, MoveTarget target, out MovedEvent moved)
    {
        moved = EventMoves.Move(resolved, target, store.DeviceZone, store.System)!;
        Assert.NotNull(moved);
        return EventMoves.Plan(resolved, moved, EventEditing.InfoOf(store.Find(resolved.Occurrence.CalendarId)!), store.System);
    }

    // ---- Week and Day (§2.5, §2.6) ------------------------------------------------------------------------

    [Fact]
    public void WeekShowsTheThirteenMonthWeekAsTimelineColumns()
    {
        var (_, calendar, _, _) = Mockup();
        calendar.Mode = CalendarMode.Week;
        var week = calendar.WeekMode;
        Assert.Equal("October 2026, week 2", week.GridName);
        Assert.Equal(7, week.Columns.Count);
        Assert.Equal(Day("2026-10-15"), week.Columns[0].Date);
        Assert.All(week.ColumnWeights, w => Assert.Equal(1, w));

        // Headers in both calendars (board F1) and the column containers' names (§2.20).
        var today = week.Columns.Single(c => c.IsToday);
        Assert.Equal(Day("2026-10-19"), today.Date);
        Assert.Equal(("THU", "12", "Mon, Oct 19"), (today.WeekdayText, today.DayText, today.GregorianText));
        Assert.Equal("Thursday, October 12. Gregorian Monday, October 19", today.AutomationName);
        Assert.Equal("Today", today.ItemStatus);
        Assert.True(today.IsSelected);

        // Today's timed events as blocks in start order, named calendar.item.a11y + flags; the bar in the all-day row.
        Assert.Equal(["Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth"], today.Blocks.Select(b => b.Title));
        var dentist = today.Blocks.Single(b => b.Title == "Dentist, Dr. Tamm");
        Assert.Equal((15 * 60 + 40, 16 * 60 + 20), (dentist.StartMinute, dentist.EndMinute));
        Assert.Equal("15:40 to 16:20", dentist.TimeText);
        Assert.Equal("Dentist, Dr. Tamm, 15:40 to 16:20, Home", dentist.AutomationName);
        Assert.StartsWith("Sprint planning, 09:30 to 10:30, Work", today.Blocks[0].AutomationName);
        var bar = Assert.Single(week.AllDay.OfType<AllDayBar>(), b => b.Title == "Autumn school break");
        Assert.Equal((4, 3, 0), (bar.Column, bar.ColumnSpan, bar.Lane));
        Assert.True(bar.ContinuesAfter);
        Assert.Equal(1, week.AllDayLanes);

        // The now line: on every column of the week that shows today, at 09:41.
        Assert.Equal(9 * 60 + 41, week.NowMinute);
        Assert.Equal("09:41", week.NowText);
        Assert.All(week.Columns, c => Assert.Equal(9 * 60 + 41, c.NowMinute));

        // The week opens at 07:00, or at its first event if earlier (Yoga on Friday at 07:15 is later).
        Assert.Equal(7 * 60, week.ScrollMinute);
        var request = week.ScrollRequest;
        calendar.Page(1);
        Assert.Equal(Day("2026-10-22"), week.Columns[0].Date);
        Assert.Equal(6 * 60 + 10, week.ScrollMinute);      // Flight TLL to AMS at 06:10 on Saturday the 24th
        Assert.Equal(request + 1, week.ScrollRequest);
        Assert.Null(week.NowMinute);
        Assert.All(week.Columns, c => Assert.Null(c.NowMinute));
    }

    [Fact]
    public void ColumnWidthSetsMaxSlotsAndCrowdedClustersGetAnOverflowBlock()
    {
        var (_, calendar, _, _) = Mockup();
        calendar.Mode = CalendarMode.Week;
        var week = calendar.WeekMode;
        Assert.Null(week.MaxSlots);
        var wednesday = week.Columns.Single(c => c.Date == Day("2026-10-21"));
        // Design review prep 13:00 to 14:15 and Design review 14:00 to 15:30 share a cluster of two slots.
        Assert.Equal(2, wednesday.Blocks.Count);
        Assert.All(wednesday.Blocks, b => Assert.Equal(2, b.SlotCount));
        Assert.Empty(wednesday.Overflows);

        // maxSlots = floor(column width / 48) (§2.5): 100 px fits two; at 60 px one slot is left, and it becomes the
        // "+{n}" block of the cluster's events from that slot on.
        week.SetColumnWidth(100);
        Assert.Equal(2, week.MaxSlots);
        Assert.Empty(week.Columns.Single(c => c.Date == Day("2026-10-21")).Overflows);
        week.SetColumnWidth(60);
        Assert.Equal(1, week.MaxSlots);
        wednesday = week.Columns.Single(c => c.Date == Day("2026-10-21"));
        var more = Assert.Single(wednesday.Overflows);
        Assert.Equal(2, more.Count);
        Assert.Equal("+2", more.Text);
        Assert.Equal(13 * 60, more.StartMinute);
        Assert.Equal("2 more events at 13:00", more.AutomationName);
        Assert.Equal(more.AutomationName, more.Heading);
        Assert.Equal(2, more.Rows.Count);
        Assert.Empty(wednesday.Blocks);
        Assert.Equal(wednesday.Elements.Count, wednesday.Blocks.Count + wednesday.Overflows.Count);

        // Day divides by 64 (§2.6).
        calendar.Mode = CalendarMode.Day;
        calendar.DayMode.SetColumnWidth(130);
        Assert.Equal(2, calendar.DayMode.MaxSlots);
    }

    [Fact]
    public void WeekFourOfDecemberHasANarrowHatchedYearDayColumn()
    {
        var (_, calendar, _, _) = Mockup();
        calendar.Date = Day("2026-12-31");
        calendar.Mode = CalendarMode.Week;
        var week = calendar.WeekMode;
        Assert.Equal(8, week.Columns.Count);
        Assert.Equal([1, 1, 1, 1, 1, 1, 1, Timeline.IntercalaryWeight], week.ColumnWeights);
        Assert.Equal([false, false, false, false, false, false, false, true], week.ColumnHatched);
        var yearDay = week.Columns[^1];
        Assert.True(yearDay.HasCode);
        Assert.Equal("YD", yearDay.Code);
        Assert.Equal("Year Day", yearDay.WeekdayText);
        Assert.Equal("Year Day 2026, no weekday. Gregorian Thursday, December 31", yearDay.AutomationName);
        Assert.Contains(yearDay.Blocks, b => b.Title == "New Year's Eve dinner");
    }

    [Fact]
    public void DayHasTheStripTheAllDayRowAndThePanel()
    {
        var (_, calendar, _, _) = Mockup();
        calendar.Mode = CalendarMode.Day;
        var day = calendar.DayMode;
        Assert.Equal("Thursday, October 12, 2026", day.GridName);
        Assert.Equal(7, day.Strip.Count);
        var shown = Assert.Single(day.Strip, s => s.IsSelected);
        Assert.Equal(Day("2026-10-19"), shown.Date);
        Assert.Equal(("THU", "12", "19"), (shown.WeekdayText, shown.DayText, shown.GregorianText));
        Assert.Equal(4, shown.NavOrder);
        Assert.Single(day.Columns);
        Assert.Equal(1, day.ColumnWeights.Single());
        Assert.Equal(4, day.Columns[0].Blocks.Count);
        Assert.Equal("Autumn school break", Assert.Single(day.AllDay.OfType<AllDayBar>()).Title);
        Assert.False(day.IsEmpty);
        Assert.Equal("Thursday, October 12", day.Heading);
        Assert.Equal("Gregorian Mon, Oct 19", day.Caption);
        Assert.NotNull(day.Comparison);
        Assert.False(day.HasSelectedEvent);

        // The panel follows the selection; Edit is offered on editable events.
        calendar.SelectedItem = day.DayItems.Single(i => i.Title == "Dentist, Dr. Tamm");
        Assert.True(day.HasSelectedEvent);
        Assert.Equal(("Dentist, Dr. Tamm", "15:40 to 16:20", "Home"), (day.SelectedEvent!.Title, day.SelectedEvent.TimeText, day.SelectedEvent.CalendarName));
        Assert.Equal("Edit", day.SelectedEvent.EditText);
        Assert.True(day.Columns[0].Blocks.Single(b => b.Title == "Dentist, Dr. Tamm").IsSelected);

        // An empty day: "No events.".
        calendar.SelectedItem = null;
        calendar.Date = Day("2026-11-11");     // IFC Saturday, November 7: nothing repeats on it
        Assert.True(day.IsEmpty);
        Assert.Equal("No events.", day.EmptyText);
    }

    [Fact]
    public void TimelineStringsHaveNoDashes()
    {
        var texts = new List<string>
        {
            MoveStrings.SpanTitle, MoveStrings.MoveMessage, MoveStrings.MoveThis, MoveStrings.MoveFuture, MoveStrings.MoveFutureChange,
            MoveStrings.MoveDeleteLater, MoveStrings.MoveKeepMessage, MoveStrings.ChangesRepeat("Friday, October 13, 2026", "every year on Year Day"),
            MoveStrings.DropsRepeat("Year Day 2026", 1), MoveStrings.DropsRepeat("Year Day 2026", 4), MoveStrings.DropsRepeatEndless("Year Day 2026"),
            MoveStrings.DropsRepeatFirst("Year Day 2026"), MoveStrings.NotAllowed("Work"), MoveStrings.ExceptionsDropped(1), MoveStrings.ExceptionsDropped(3),
            MoveStrings.Cancel, MoveStrings.MovedDay("Friday, October 13, 2026"), MoveStrings.MovedTime("14:00"), MoveStrings.MovedDayTime("Friday, October 13, 2026", "14:00"),
            MoveStrings.Saved, MoveStrings.Undo, MoveStrings.Close, MoveStrings.AnnounceUndo("Event moved to 14:00."), MoveStrings.OverflowBlock(3), MoveStrings.AllDayRow,
        };
        texts.AddRange(Enum.GetValues<DraftIssue>().Select(MoveStrings.Issue));
        texts.AddRange(Enumerable.Range(0, 24).SelectMany(h => new[] { MoveStrings.HourLabel(h, true), MoveStrings.HourLabel(h, false) }));
        Assert.All(texts, t => Assert.False(t.Contains('\u2013') || t.Contains('\u2014'), t));
        Assert.Equal("Changes you made to 1 single event after this one will be removed.", MoveStrings.ExceptionsDropped(1));
        Assert.Equal("Changes you made to 3 single events after this one will be removed.", MoveStrings.ExceptionsDropped(3));
        Assert.Equal(("09:00", "9 AM", "12 PM", "12 AM"), (MoveStrings.HourLabel(9, true), MoveStrings.HourLabel(9, false), MoveStrings.HourLabel(12, false), MoveStrings.HourLabel(0, false)));
    }

    // ---- Planning a drop (§2.11 "Drag edits") ---------------------------------------------------------------

    [Fact]
    public async Task ASingleEventIsHeldAtOnce()
    {
        var (store, resolved) = await Resolve("2026-10-19", "Dentist, Dr. Tamm");
        Assert.False(resolved.IsRepeating);
        var plan = Plan(store, resolved, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-20T14:00")), out var moved);
        var single = Assert.IsType<MovePlan.Single>(plan);
        Assert.Null(single.Draft.Recurrence);
        Assert.Equal((LocalDateTime.Parse("2026-10-20T14:00"), LocalDateTime.Parse("2026-10-20T14:40")), (moved.Start, moved.End));
        Assert.Equal("Event moved to Friday, October 13, 2026 at 14:00.", EventMoves.MovedMessage(false, resolved.Occurrence.Start, moved, store.System));

        // The same day: the time only; a new end: "Event saved."; a drop that changes nothing: no move.
        var later = EventMoves.Move(resolved, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-19T17:00")), store.DeviceZone, store.System)!;
        Assert.Equal("Event moved to 17:00.", EventMoves.MovedMessage(false, resolved.Occurrence.Start, later, store.System));
        var longer = EventMoves.Move(resolved, MoveTarget.ToEnd(LocalDateTime.Parse("2026-10-19T17:00")), store.DeviceZone, store.System)!;
        Assert.Equal((LocalDateTime.Parse("2026-10-19T15:40"), LocalDateTime.Parse("2026-10-19T17:00")), (longer.Start, longer.End));
        Assert.Equal("Event saved.", EventMoves.MovedMessage(false, resolved.Occurrence.Start, longer, store.System));
        var shortest = EventMoves.Move(resolved, MoveTarget.ToEnd(LocalDateTime.Parse("2026-10-19T15:00")), store.DeviceZone, store.System)!;
        Assert.Equal(LocalDateTime.Parse("2026-10-19T15:55"), shortest.End);     // at least 15 minutes long
        Assert.Null(EventMoves.Move(resolved, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-19T15:40")), store.DeviceZone, store.System));
        Assert.Null(EventMoves.Move(resolved, MoveTarget.ToDay(Day("2026-10-19"), Day("2026-10-19")), store.DeviceZone, store.System));
    }

    [Fact]
    public async Task DropsOnTheAllDayRowAndTheTimelineChangeAllDay()
    {
        var (store, dentist) = await Resolve("2026-10-19", "Dentist, Dr. Tamm");
        var whole = EventMoves.Move(dentist, MoveTarget.ToAllDay(Day("2026-10-21"), Day("2026-10-19")), store.DeviceZone, store.System)!;
        Assert.True(whole.AllDay);
        Assert.True(whole.Draft.AllDay);
        Assert.Equal(Day("2026-10-21"), whole.Start.Date);
        Assert.Equal("Event moved to Saturday, October 14, 2026.", EventMoves.MovedMessage(false, dentist.Occurrence.Start, whole, store.System));

        var (_, lunch) = await Resolve("2026-10-16", "Lunch with Jaan", store);
        Assert.IsType<MovePlan.Single>(Plan(store, lunch, MoveTarget.ToAllDay(Day("2026-10-16"), Day("2026-10-16")), out var lunchAllDay));
        Assert.True(lunchAllDay.AllDay);

        // An all-day bar dropped on the timeline becomes one hour there, in the device's zone.
        var (_, offsite) = await Resolve("2026-10-12", "Team offsite, Pärnu", store);
        var timed = EventMoves.Move(offsite, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-16T10:00")), store.DeviceZone, store.System)!;
        Assert.False(timed.AllDay);
        Assert.Equal((LocalDateTime.Parse("2026-10-16T10:00"), LocalDateTime.Parse("2026-10-16T11:00")), (timed.Start, timed.End));
        Assert.Equal(StoreTesting.Tallinn, timed.Draft.TimeZone);
        // An all-day bar moved along the row keeps its length.
        var along = EventMoves.Move(offsite, MoveTarget.ToAllDay(Day("2026-10-14"), Day("2026-10-13")), store.DeviceZone, store.System)!;
        Assert.Equal((LocalDateTime.Parse("2026-10-13T00:00"), LocalDateTime.Parse("2026-10-15T24:00")), (along.Start, along.End));
    }

    [Fact]
    public async Task ARepeatingOccurrenceAsksTheSpanFirst()
    {
        var (store, resolved) = await Resolve("2026-10-19", "1:1 with Marta");
        Assert.True(resolved.IsRepeating);
        Assert.True(EventMoves.CanMoveFuture(resolved));
        var question = Assert.IsType<MovePlan.Question>(Plan(store, resolved, MoveTarget.ToDay(Day("2026-10-20"), Day("2026-10-19")), out _));
        Assert.Equal("This is a repeating event.", question.Title);
        Assert.Equal("Move this event only, or this and all future events?", question.Message);
        Assert.Empty(question.Lines);
        Assert.Equal(["Move this event only", "Move future events"], question.Choices.Select(c => c.Label));
        Assert.Equal([MoveSpan.This, MoveSpan.Future], question.Choices.Select(c => c.Span));
        Assert.Null(question.Choices[0].Draft.Recurrence);       // an override never repeats
        Assert.NotNull(question.Choices[1].Draft.Recurrence);
        Assert.False(question.Choices[1].Destructive);
    }

    [Fact]
    public async Task MovingOntoAnIntercalaryDayDropsOrConvertsTheRepeat()
    {
        // Book club repeats on the 12th of every 13-month month: Year Day has no 12th, so the repeat would end.
        var (store, club) = await Resolve("2026-12-14", "Book club: Cotsworth");
        var dropped = Assert.IsType<MovePlan.Question>(Plan(store, club, MoveTarget.ToDay(Day("2026-12-31"), Day("2026-12-14")), out var moved));
        Assert.Equal(RepeatChange.Dropped, moved.RepeatChange);
        Assert.Equal("Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.", dropped.Message);
        Assert.Equal(["Move this event only", "Move and delete later events"], dropped.Choices.Select(c => c.Label));
        Assert.True(dropped.Choices[1].Destructive);
        Assert.Null(dropped.Choices[1].Draft.Recurrence);

        // From its first occurrence: the series becomes one event.
        var (_, first) = await Resolve("2026-01-12", "Book club: Cotsworth", store);
        Assert.True(first.IsFirst);
        var firstQuestion = Assert.IsType<MovePlan.Question>(Plan(store, first, MoveTarget.ToDay(Day("2025-12-31"), Day("2026-01-12")), out _));
        Assert.Equal("Moving the first event to Year Day 2025 ends the repeat. The series becomes one event on Year Day 2025.", firstQuestion.Message);

        // A yearly 13-month repeat becomes the intercalary day's repeat: "changes the repeat to".
        var calendar = await store.CreateCalendarAsync("Anniversaries");
        var rule = new ThirteenRule.Yearly(CalendarSystemId.Ifc, 13, 1);
        var anniversary = StoreTesting.AllDay("anniversary", "Anniversary", "2026-12-03", "2026-12-03") with
        {
            RRules = new[] { rule.Encode(Day("2026-12-03")).RRule }.ToValueList(),
            ThirteenRule = rule.ToMarkerText(),
        };
        await StoreTesting.Put(store, calendar.Id, anniversary);
        var (_, yearly) = await Resolve("2026-12-03", "Anniversary", store);
        Assert.True(yearly.IsFirst);
        var converted = Assert.IsType<MovePlan.Question>(Plan(store, yearly, MoveTarget.ToDay(Day("2026-12-31"), Day("2026-12-03")), out var conversion));
        Assert.Equal(RepeatChange.Converted, conversion.RepeatChange);
        Assert.StartsWith("Moving future events to Year Day 2026 changes the repeat to ", converted.Message);
        Assert.Equal(["Move this event only", "Move future events and change repeat"], converted.Choices.Select(c => c.Label));
    }

    [Fact]
    public async Task FutureEventsSayWhichChangedEventsTheyRemove()
    {
        // November 2's 1:1 and January 12's book club were moved on their own (overrides).
        var store = new FakeEventStore();
        await store.LoadAsync();
        async Task Override(string date, string title, string start, string end)
        {
            var (_, one) = await Resolve(date, title, store);
            await store.UpdateGroupAsync(one.Occurrence.CalendarId, one.Occurrence.Uid, (document, group) =>
                EventEdits.MoveOccurrence(document, group, one.Occurrence, LocalDateTime.Parse(start), LocalDateTime.Parse(end),
                    store.DeviceZone, store.Zones, EventMoves.ContextOf(store).Now));
        }
        await Override("2026-11-02", "1:1 with Marta", "2026-11-02T13:00", "2026-11-02T13:30");
        await Override("2027-01-12", "Book club: Cotsworth", "2027-01-13T19:00", "2027-01-13T21:00");

        // The 1:1 later the same day: the changed event moves with the series, nothing is lost.
        var (_, marta) = await Resolve("2026-10-26", "1:1 with Marta", store);
        Assert.Single(marta.OverrideDates);
        var retimed = Assert.IsType<MovePlan.Question>(Plan(store, marta, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-26T12:00")), out var later));
        Assert.Equal(0, EventMoves.DroppedChanges(marta, later));
        Assert.Empty(retimed.Lines);

        // The book club onto Year Day ends the repeat: the later changed event goes too, said before the choice.
        var (_, club) = await Resolve("2026-12-14", "Book club: Cotsworth", store);
        Assert.Single(club.OverrideDates);
        var question = Assert.IsType<MovePlan.Question>(Plan(store, club, MoveTarget.ToDay(Day("2026-12-31"), Day("2026-12-14")), out var moved));
        Assert.Equal(RepeatChange.Dropped, moved.RepeatChange);
        Assert.Equal(1, EventMoves.DroppedChanges(club, moved));
        Assert.Equal(["Changes you made to 1 single event after this one will be removed."], question.Lines);
    }

    [Fact]
    public async Task RepeatsSetInAnotherAppMoveOnlyThisEvent()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        var calendar = await store.CreateCalendarAsync("Imported");
        var series = StoreTesting.Timed("standup", "Standup", "2026-10-19T09:00", "2026-10-19T09:15") with
        {
            // Two RRULEs: a repeat the editor cannot express (§4.5 "foreign", editable: false).
            RRules = new[] { RRule.Parse("FREQ=WEEKLY;BYDAY=MO"), RRule.Parse("FREQ=WEEKLY;BYDAY=WE") }.ToValueList(),
        };
        await StoreTesting.Put(store, calendar.Id, series);
        var (_, resolved) = await Resolve("2026-10-21", "Standup", store);
        Assert.True(resolved.IsRepeating);
        Assert.False(EventMoves.CanMoveFuture(resolved));
        var question = Assert.IsType<MovePlan.Question>(Plan(store, resolved, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-21T10:00")), out _));
        Assert.Equal("Its repeat was set in another app, so only this event can be moved.", question.Message);
        Assert.Equal(["Move this event only"], question.Choices.Select(c => c.Label));
    }

    [Fact]
    public async Task ADropTheEditorWouldRefuseIsRefused()
    {
        var (store, resolved) = await Resolve("2026-10-19", "Dentist, Dr. Tamm");
        var moved = EventMoves.Move(resolved, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-20T14:00")), store.DeviceZone, store.System)!;
        var readOnly = EventEditing.InfoOf(store.Find("home")!) with { Writable = false };
        var refused = Assert.IsType<MovePlan.Refused>(EventMoves.Plan(resolved, moved, readOnly, store.System));
        Assert.Equal(MoveStrings.Issue(DraftIssue.CalendarReadOnly), refused.Message);
        Assert.Contains(DraftIssue.CalendarReadOnly, EventMoves.Issues(moved.Draft, readOnly));
    }

    // ---- Holding, showing, undoing and writing (§2.11) ------------------------------------------------------

    [AvaloniaFact]
    public async Task AMoveIsHeldShownAtOnceAndUndone()
    {
        var (_, calendar, store, pending) = Mockup();
        calendar.Mode = CalendarMode.Week;
        var dentist = Item(calendar, "2026-10-19", "Dentist, Dr. Tamm");
        Assert.True(await calendar.Mover.MoveAsync(dentist, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-20T14:00"))));
        var change = Assert.Single(pending.Pending);
        Assert.Equal(PendingState.Pending, change.State);
        Assert.True(calendar.Mover.Toast.IsOpen);
        Assert.True(calendar.Mover.Toast.HasChange);
        Assert.Equal("Event moved to Friday, October 13, 2026 at 14:00.", calendar.Mover.Toast.Message);
        Assert.Equal("Event moved to Friday, October 13, 2026 at 14:00. Undo available: Control Z.", calendar.Announcement);

        // Shown where it was dropped at once, nothing written yet.
        var week = calendar.WeekMode;
        Assert.DoesNotContain(week.Columns.Single(c => c.Date == Day("2026-10-19")).Blocks, b => b.Title == "Dentist, Dr. Tamm");
        var moved = week.Columns.Single(c => c.Date == Day("2026-10-20")).Blocks.Single(b => b.Title == "Dentist, Dr. Tamm");
        Assert.Equal((14 * 60, 14 * 60 + 40), (moved.StartMinute, moved.EndMinute));
        Assert.Equal(LocalDateTime.Parse("2026-10-19T15:40"), store.Occurrences(Day19, Day19.AddMinutes(1440)).Single(o => o.Title == "Dentist, Dr. Tamm").Start);

        // Undo discards it: nothing was written.
        calendar.Mover.Toast.UndoCommand.Execute(null);
        Assert.Empty(pending.Pending);
        Assert.False(calendar.Mover.Toast.IsOpen);
        Assert.Contains(week.Columns.Single(c => c.Date == Day("2026-10-19")).Blocks, b => b.Title == "Dentist, Dr. Tamm");
    }

    [AvaloniaFact]
    public async Task CloseWritesTheHeldMoveAndTheAllDaySetting()
    {
        var (_, calendar, store, pending) = Mockup();
        var lunch = Item(calendar, "2026-10-16", "Lunch with Jaan");
        Assert.True(await calendar.Mover.MoveAsync(lunch, MoveTarget.ToAllDay(Day("2026-10-17"), Day("2026-10-16"))));
        var change = Assert.Single(pending.Pending);
        Assert.True(change.IsAllDay);
        Assert.Equal("Event moved to Tuesday, October 10, 2026.", calendar.Mover.Toast.Message);
        await calendar.Mover.Toast.CloseCommand.ExecuteAsync(null);
        Assert.Equal(PendingState.Written, change.State);
        Assert.False(calendar.Mover.Toast.IsOpen);
        var day17 = LocalDateTime.Parse("2026-10-17T00:00");
        var written = store.Occurrences(day17, day17.AddMinutes(1440)).Single(o => o.Title == "Lunch with Jaan");
        Assert.True(written.AllDay);
        Assert.Equal(day17, written.Start);
    }

    [AvaloniaFact]
    public async Task TheSpanQuestionDecidesAndFutureEventsAreWrittenAtOnce()
    {
        var (_, calendar, store, pending) = Mockup();
        var sprint = Item(calendar, "2026-10-19", "Sprint planning");

        // Cancel: nothing moves.
        MovePlan.Question? asked = null;
        calendar.Mover.Ask = (question, _) =>
        {
            asked = question;
            return Task.FromResult<MoveChoice?>(null);
        };
        Assert.False(await calendar.Mover.MoveAsync(sprint, MoveTarget.ToDay(Day("2026-10-20"), Day("2026-10-19"))));
        Assert.NotNull(asked);
        Assert.Same(asked, calendar.Mover.LastQuestion);
        Assert.Empty(pending.Pending);

        // "Move future events": a split, written at once, no Undo.
        calendar.Mover.Ask = (question, _) => Task.FromResult<MoveChoice?>(question.Choices.Single(c => c.Span == MoveSpan.Future));
        Assert.True(await calendar.Mover.MoveAsync(sprint, MoveTarget.ToDay(Day("2026-10-20"), Day("2026-10-19"))));
        Assert.Empty(pending.Pending);
        Assert.False(calendar.Mover.Toast.HasChange);
        Assert.Equal("Event moved to Friday, October 13, 2026.", calendar.Mover.Toast.Message);
        var from = LocalDateTime.Parse("2026-10-01T00:00");
        var sprints = store.Occurrences(from, from.AddMinutes(1440 * 40)).Where(o => o.Title == "Sprint planning").Select(o => o.Start.ToString()).ToArray();
        Assert.Equal(["2026-10-05T09:30", "2026-10-20T09:30", "2026-11-03T09:30"], sprints);
        Assert.Equal(2, store.Find("work")!.Document!.Groups.Count(g => g.Master?.Summary == "Sprint planning"));

        // "Move this event only": an override, held.
        var marta = Item(calendar, "2026-10-19", "1:1 with Marta");
        calendar.Mover.Ask = (question, _) => Task.FromResult<MoveChoice?>(question.Choices.Single(c => c.Span == MoveSpan.This));
        Assert.True(await calendar.Mover.MoveAsync(marta, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-19T12:00"))));
        Assert.Single(pending.Pending);
        Assert.Equal("Event moved to 12:00.", calendar.Mover.Toast.Message);
        await calendar.Mover.Toast.CommitAsync();
        var marta19 = store.Occurrences(Day19, Day19.AddMinutes(1440)).Single(o => o.Title == "1:1 with Marta");
        Assert.Equal(LocalDateTime.Parse("2026-10-19T12:00"), marta19.Start);
        var marta26 = store.Occurrences(Day19.AddMinutes(1440 * 7), Day19.AddMinutes(1440 * 8)).Single(o => o.Title == "1:1 with Marta");
        Assert.Equal(LocalDateTime.Parse("2026-10-26T11:00"), marta26.Start);
    }

    [AvaloniaFact]
    public async Task FromTheFirstOccurrenceTheWholeSeriesMoves()
    {
        var (_, calendar, store, _) = Mockup();
        var local = await store.CreateCalendarAsync("Training");
        var series = StoreTesting.Timed("intervals", "Intervals", "2026-10-19T18:00", "2026-10-19T19:00") with
        {
            RRules = new[] { RRule.Parse("FREQ=WEEKLY") }.ToValueList(),
        };
        await StoreTesting.Put(store, local.Id, series);
        var first = Item(calendar, "2026-10-19", "Intervals");
        calendar.Mover.Ask = (question, _) => Task.FromResult<MoveChoice?>(question.Choices.Single(c => c.Span == MoveSpan.Future));
        Assert.True(await calendar.Mover.MoveAsync(first, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-19T19:30"))));
        var starts = store.Occurrences(Day19, Day19.AddMinutes(1440 * 15)).Where(o => o.Title == "Intervals").Select(o => o.Start.ToString()).ToArray();
        Assert.Equal(["2026-10-19T19:30", "2026-10-26T19:30", "2026-11-02T19:30"], starts);
        Assert.Single(store.Find(local.Id)!.Document!.Groups, g => g.Master?.Summary == "Intervals");
    }

    [AvaloniaFact]
    public async Task ReadOnlyEventsAreNotMovedButCanBeCopied()
    {
        var (_, calendar, _, pending) = Mockup();
        var requests = new List<string>();
        var actions = new PlaceholderCalendarActions();
        actions.Requested += requests.Add;
        calendar.Actions = actions;
        // Halloween is in a subscription (read only, §2.15).
        var review = Item(calendar, "2026-10-31", "Halloween");
        Assert.False(EventMover.CanMove(review));
        Assert.False(await calendar.Mover.MoveAsync(review, MoveTarget.ToAllDay(Day("2026-11-01"), Day("2026-10-31"))));
        Assert.Empty(pending.Pending);
        Assert.Equal(CalendarStrings.ReadOnlyReason(review.ReadOnly), calendar.Announcement);

        calendar.Mover.Copy(review, Day("2026-10-22"), 16 * 60, null);
        Assert.Equal($"duplicate {review.Key}", requests[^1]);
        calendar.Mover.NewFromRange(Day("2026-10-22"), 10 * 60 + 30, 9 * 60, null);
        Assert.Equal("new 2026-10-22 540", requests[^1]);
    }

    [AvaloniaFact]
    public async Task TheNextActionCommitsTheHeldMove()
    {
        var (_, calendar, store, pending) = Mockup();
        calendar.Mode = CalendarMode.Week;
        var dentist = Item(calendar, "2026-10-19", "Dentist, Dr. Tamm");
        Assert.True(await calendar.Mover.MoveAsync(dentist, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-19T17:00"))));
        var change = Assert.Single(pending.Pending);
        calendar.Page(1);
        await StoreTesting.Eventually(() => change.State == PendingState.Written, "the held move written after paging");
        Assert.Equal(LocalDateTime.Parse("2026-10-19T17:00"), store.Occurrences(Day19, Day19.AddMinutes(1440)).Single(o => o.Title == "Dentist, Dr. Tamm").Start);

        // A second move of the same event writes the first, then moves it from where it is.
        calendar.Page(-1);
        dentist = Item(calendar, "2026-10-19", "Dentist, Dr. Tamm");
        Assert.True(await calendar.Mover.MoveAsync(dentist, MoveTarget.ToTime(LocalDateTime.Parse("2026-10-19T18:00"))));
        var second = Assert.Single(pending.Pending);
        dentist = Item(calendar, "2026-10-19", "Dentist, Dr. Tamm");
        Assert.True(await calendar.Mover.MoveAsync(dentist, MoveTarget.ToEnd(LocalDateTime.Parse("2026-10-19T19:00"))));
        Assert.Equal(PendingState.Written, second.State);
        await calendar.Mover.Toast.CommitAsync();
        var final = store.Occurrences(Day19, Day19.AddMinutes(1440)).Single(o => o.Title == "Dentist, Dr. Tamm");
        Assert.Equal((LocalDateTime.Parse("2026-10-19T18:00"), LocalDateTime.Parse("2026-10-19T19:00")), (final.Start, final.End));
    }
}
