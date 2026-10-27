using System.Text;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// Review findings (data integrity and engine use) for the Windows event store, its iCalendar model
/// (Services/EventEditing.cs, EventEdits.cs), pending changes, undo, restore and import. Every test states what
/// docs/EVENTS.md requires and runs on the real file store (<see cref="EventStore"/> in a temporary folder) through the
/// same writer the editor, the drags and the undo stack use. Each one failed on the code the review read.
/// </summary>
public class ReviewFindingsDataTests
{
    private const string Tallinn = StoreTesting.Tallinn;

    private static async Task<(EventStore Store, EventWriter Writer, string Personal)> OpenAsync(TempFolder folder)
    {
        var store = StoreTesting.Store(folder);
        await store.LoadAsync();
        return (store, new EventWriter(store, store.Clock), store.Calendars.Single().Id);
    }

    private static LocalDateTime At(string text) => LocalDateTime.Parse(text);

    private static EventDraft Timed(string calendarId, string title, string start, string end, EventRecurrence? recurrence = null) =>
        Drafts.New(At(start).Date, At("2026-10-19T09:41"), calendarId, timeZone: Tallinn) with
        {
            Title = title,
            Start = At(start),
            End = At(end),
            Recurrence = recurrence,
        };

    private static EventRecurrence Weekly(RepeatEnd end) => new(RepeatRule.Of(RRule.Parse("FREQ=WEEKLY")), end);

    private static async Task<string> CreateAsync(EventWriter writer, EventDraft draft)
    {
        var outcome = await writer.RunAsync(draft.CalendarId, (ws, ctx) => EventEditing.Create(ws, draft, ctx));
        return outcome.Result.Uid!;
    }

    private static IReadOnlyList<IcsExpandedEvent> Year(IEventStore store, int year = 2026) =>
        store.Occurrences(new LocalDateTime(new GregorianDate(year, 1, 1), 0), new LocalDateTime(new GregorianDate(year + 1, 1, 1), 0));

    private static List<string> Starts(IEventStore store, string title) =>
        Year(store).Where(o => o.Title == title).Select(o => o.Start.ToString()).ToList();

    private static IcsExpandedEvent Occurrence(IEventStore store, string uid, string start) =>
        Year(store).Single(o => o.Uid == uid && o.Start.ToString() == start);

    private static Task<WriteOutcome> SaveAsync(EventWriter writer, IcsExpandedEvent occurrence, EventDraft original, EventDraft draft, EditSpan span) =>
        writer.RunAsync(occurrence.CalendarId, (ws, ctx) => EventEditing.Save(ws, occurrence, original, draft, span, ctx));

    /// <summary>The unfolded content lines of the VEVENT with this UID (the master) in a stored file.</summary>
    private static List<string> MasterLines(TempFolder folder, string calendarId, string uid)
    {
        var text = File.ReadAllText(folder.File(calendarId + ".ics")).Replace("\r\n ", "", StringComparison.Ordinal).Replace("\r\n\t", "", StringComparison.Ordinal);
        var blocks = text.Split("BEGIN:VEVENT\r\n").Skip(1).Select(b => b[..b.IndexOf("END:VEVENT", StringComparison.Ordinal)].Split("\r\n").ToList());
        return blocks.Single(lines => lines.Contains("UID:" + uid) && !lines.Any(l => l.StartsWith("RECURRENCE-ID", StringComparison.Ordinal)));
    }

    // ---- §4.9 rule 3: a 13-month rule whose start moves is written in its encoding from the new start ----------

    [Fact]
    public async Task MovingTheFirstEventOfAnIfcEveryTwoWeeksSeriesByAWeekWritesTheNewFortnight()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var start = new GregorianDate(2026, 10, 19);                         // IFC Thursday, October 12
        var rule = ThirteenRule.For(ThirteenRuleKind.Biweekly, start, CalendarSystemId.Ifc)!;
        var uid = await CreateAsync(writer, Timed(personal, "Fortnightly", "2026-10-19T10:00", "2026-10-19T11:00", new EventRecurrence(RepeatRule.Of(rule), RepeatEnd.Never)));
        var first = Occurrence(store, uid, "2026-10-19T10:00");
        var resolved = writer.Resolve(first)!;
        Assert.True(resolved.IsFirst);
        // The editor's date field moves the start one week later; the repeat stays "Every 2 IFC weeks on Thursday".
        var moved = Drafts.MoveStart(resolved.Draft, At("2026-10-26T10:00"), CalendarSystemId.Ifc);
        Assert.Equal(RepeatChange.None, moved.RepeatChange);
        await SaveAsync(writer, first, resolved.Draft, moved.Draft, EditSpan.Future);

        // Every other Thursday from the new start: October 26, November 9, November 23 (Gregorian).
        Assert.Equal(["2026-10-26T10:00", "2026-11-09T10:00", "2026-11-23T10:00"], Starts(store, "Fortnightly").Where(s => string.CompareOrdinal(s, "2026-11-30") < 0));
        // §4.9 rule 3: "written in the new rule's own RRULE encoding".
        Assert.Contains("RRULE:" + rule.Encode(new GregorianDate(2026, 10, 26)).RRule, MasterLines(folder, personal, uid));
    }

    [Fact]
    public async Task FutureEventsOfAnIfcEveryTwoWeeksSeriesMovedByAWeekGiveEveryOtherThursdayFromTheNewDate()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var start = new GregorianDate(2026, 10, 5);                          // IFC Thursday, September 26
        var rule = ThirteenRule.For(ThirteenRuleKind.Biweekly, start, CalendarSystemId.Ifc)!;
        var uid = await CreateAsync(writer, Timed(personal, "Fortnightly", "2026-10-05T10:00", "2026-10-05T11:00", new EventRecurrence(RepeatRule.Of(rule), RepeatEnd.Never)));
        var third = Occurrence(store, uid, "2026-10-19T10:00");
        var resolved = writer.Resolve(third)!;
        // Dragged (or re-dated in the editor) one week later, future events; the repeat stays the same.
        var moved = Drafts.MoveStart(resolved.Draft, At("2026-10-26T10:00"), CalendarSystemId.Ifc);
        Assert.Equal(RepeatChange.None, moved.RepeatChange);
        await SaveAsync(writer, third, resolved.Draft, moved.Draft, EditSpan.Future);

        Assert.Equal(
            ["2026-10-05T10:00", "2026-10-26T10:00", "2026-11-09T10:00", "2026-11-23T10:00"],
            Starts(store, "Fortnightly").Where(s => string.CompareOrdinal(s, "2026-11-30") < 0));
    }

    // ---- §4.7 splits: the tail's UNTIL is written for the tail's own time and form ----------------------------

    [Fact]
    public async Task AFutureEventsTailTurnedAllDayGetsADateUntil()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var uid = await CreateAsync(writer, Timed(personal, "Standup", "2026-10-05T10:00", "2026-10-05T10:30", Weekly(RepeatEnd.Until(new GregorianDate(2026, 12, 28)))));
        var third = Occurrence(store, uid, "2026-10-19T10:00");
        var resolved = writer.Resolve(third)!;
        var allDay = Drafts.SetAllDay(resolved.Draft, true);
        var outcome = await SaveAsync(writer, third, resolved.Draft, allDay, EditSpan.Future);
        var tail = MasterLines(folder, personal, outcome.Result.Uid!);
        Assert.Contains("DTSTART;VALUE=DATE:20261019", tail);
        // RFC 5545 §3.3.10 and §4.7 "an all-day toggle would leave a date-time UNTIL beside DTSTART;VALUE=DATE, which
        // RFC 5545 forbids": an all-day series has a DATE UNTIL.
        Assert.Equal("RRULE:FREQ=WEEKLY;UNTIL=20261228", tail.Single(l => l.StartsWith("RRULE:", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task AFutureEventsTailAtALaterTimeKeepsTheLastEventOfAnOutlookUntil()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        // Outlook writes UNTIL at the last occurrence's start: 19:00 Tallinn on November 16 is 17:00Z.
        await StoreTesting.Put(store, personal, StoreTesting.Timed("choir@outlook", "Choir", "2026-10-05T19:00", "2026-10-05T20:00") with
        {
            RRules = [RRule.Parse("FREQ=WEEKLY;UNTIL=20261116T170000Z")],
        });
        Assert.Equal(7, Starts(store, "Choir").Count);
        var third = Occurrence(store, "choir@outlook", "2026-10-19T19:00");
        var resolved = writer.Resolve(third)!;
        var later = resolved.Draft with { Start = At("2026-10-19T19:30"), End = At("2026-10-19T20:30") };
        await SaveAsync(writer, third, resolved.Draft, later, EditSpan.Future);
        // §4.7: "an UNTIL tail keeps the original until date" (November 16), at its new time.
        Assert.Equal(
            ["2026-10-05T19:00", "2026-10-12T19:00", "2026-10-19T19:30", "2026-10-26T19:30", "2026-11-02T19:30", "2026-11-09T19:30", "2026-11-16T19:30"],
            Starts(store, "Choir"));
    }

    // ---- §3.6: a move between local calendars never replaces another calendar's event ---------------------------

    [Fact]
    public async Task MovingAnEventIntoACalendarThatHoldsTheSameUidKeepsBothEvents()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var work = (await store.CreateCalendarAsync("Work")).Id;
        // The same file imported into both calendars (§3.2: a UID is unique only within its calendar).
        await StoreTesting.Put(store, personal, StoreTesting.Timed("team-dinner@example.com", "Team dinner", "2026-10-23T19:00", "2026-10-23T22:00"));
        await StoreTesting.Put(store, work, StoreTesting.Timed("team-dinner@example.com", "Team dinner (work copy)", "2026-10-23T19:00", "2026-10-23T22:00"));
        var occurrence = Year(store).Single(o => o.CalendarId == personal);
        var resolved = writer.Resolve(occurrence)!;
        await SaveAsync(writer, occurrence, resolved.Draft, resolved.Draft with { CalendarId = work }, EditSpan.All);

        var titles = Year(store).Select(o => $"{(o.CalendarId == work ? "Work" : "Personal")}: {o.Title}").Order(StringComparer.Ordinal).ToList();
        Assert.Equal(["Work: Team dinner", "Work: Team dinner (work copy)"], titles);
    }

    // ---- §4.7: the first occurrence, changed on its own, edited again for the whole series --------------------

    [Fact]
    public async Task ATitleChangeForFutureEventsOnAFirstEventChangedOnItsOwnShowsOnThatEvent()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var uid = await CreateAsync(writer, Timed(personal, "Choir", "2026-10-05T19:00", "2026-10-05T20:00", Weekly(RepeatEnd.AfterCount(4))));
        // The first occurrence alone moves to 19:30 ("this event only").
        var first = Occurrence(store, uid, "2026-10-05T19:00");
        var opened = writer.Resolve(first)!;
        await SaveAsync(writer, first, opened.Draft, opened.Draft with { Start = At("2026-10-05T19:30"), End = At("2026-10-05T20:30") }, EditSpan.This);
        // Opened again and renamed "for future events": on the first occurrence that is the whole series.
        var again = Occurrence(store, uid, "2026-10-05T19:30");
        var resolved = writer.Resolve(again)!;
        Assert.True(resolved.IsFirst);
        await SaveAsync(writer, again, resolved.Draft, resolved.Draft with { Title = "Choir rehearsal" }, EditSpan.Future);

        var shown = Year(store).Where(o => o.Uid == uid).Select(o => $"{o.Start} {o.Title}").ToList();
        Assert.Equal(["2026-10-05T19:30 Choir rehearsal", "2026-10-12T19:00 Choir rehearsal", "2026-10-19T19:00 Choir rehearsal", "2026-10-26T19:00 Choir rehearsal"], shown);
    }

    [Fact]
    public async Task ANewTimeForFutureEventsOnAFirstEventMovedToTheNextDayKeepsTheSeriesOnItsDays()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        // Every week on Monday (FREQ=WEEKLY from Monday, October 5), four times.
        var uid = await CreateAsync(writer, Timed(personal, "Choir", "2026-10-05T19:00", "2026-10-05T20:00", Weekly(RepeatEnd.AfterCount(4))));
        // The first occurrence alone moves to Tuesday ("this event only").
        var first = Occurrence(store, uid, "2026-10-05T19:00");
        var opened = writer.Resolve(first)!;
        await SaveAsync(writer, first, opened.Draft, opened.Draft with { Start = At("2026-10-06T19:00"), End = At("2026-10-06T20:00") }, EditSpan.This);
        // Opened again on Tuesday and given 20:00 "for future events" (the date is not touched in this edit).
        var again = Occurrence(store, uid, "2026-10-06T19:00");
        var resolved = writer.Resolve(again)!;
        Assert.True(resolved.IsFirst);
        await SaveAsync(writer, again, resolved.Draft, resolved.Draft with { Start = At("2026-10-06T20:00"), End = At("2026-10-06T21:00") }, EditSpan.Future);

        // The opened event is at 20:00 on its Tuesday, and the series stays on Mondays at 20:00.
        Assert.Equal(["2026-10-06T20:00", "2026-10-12T20:00", "2026-10-19T20:00", "2026-10-26T20:00"], Starts(store, "Choir"));
    }

    // ---- §4.7 "Delete all future events" leaves no invisible series --------------------------------------------

    [Fact]
    public async Task DeletingAllFutureEventsAfterTheFirstWasDeletedAloneRemovesTheGroup()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var uid = await CreateAsync(writer, Timed(personal, "Yoga", "2026-10-05T08:00", "2026-10-05T09:00", Weekly(RepeatEnd.AfterCount(3))));
        var first = Occurrence(store, uid, "2026-10-05T08:00");
        await writer.RunAsync(personal, (ws, ctx) => EventEditing.Delete(ws, first, EditSpan.This, ctx));
        var second = Occurrence(store, uid, "2026-10-12T08:00");
        await writer.RunAsync(personal, (ws, ctx) => EventEditing.Delete(ws, second, EditSpan.Future, ctx));
        Assert.Empty(Starts(store, "Yoga"));
        // Nothing of the series is left: no VEVENT whose only occurrence is excluded (it would still be exported and
        // counted, and it can never be opened again to delete it).
        Assert.Null(store.FindGroup(personal, uid));
    }

    // ---- §2.17 Restore and §3.6: a restored calendar keeps its id and stays in the Calendars folder -------------

    private static string Export(string id, string name, string summary) => string.Join("\r\n",
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Haugas Development OU//Thirteen 1.0//EN",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:" + name,
        "NAME:" + name,
        "X-THIRTEEN-CALENDAR-ID:" + id,
        "BEGIN:VEVENT",
        "UID:restored-1",
        "DTSTAMP:20261001T080000Z",
        "LAST-MODIFIED:20261001T080000Z",
        "SUMMARY:" + summary,
        "DTSTART;TZID=Europe/Tallinn:20261023T190000",
        "DTEND;TZID=Europe/Tallinn:20261023T220000",
        "END:VEVENT",
        "END:VCALENDAR",
        "");

    [Fact]
    public async Task ACalendarRestoredFromABackupIsStillThereAfterARestart()
    {
        using var folder = new TempFolder();
        // A backup whose calendar id is not a UUID (written by hand, by another app, or by a web build that kept an id as read).
        var plan = ImportExport.ReadFiles([("Club.ics", Encoding.UTF8.GetBytes(Export("running club 2026", "Running club", "Club dinner")))], WindowsZoneResolver.Shared);
        Assert.True(plan.IsRestore);
        using (var store = StoreTesting.Store(folder))
        {
            await store.LoadAsync();
            var outcome = await ImportExport.RestoreAsync(store, plan.Sources);
            Assert.Equal(1, outcome.Calendars);
            Assert.Contains(store.Calendars, c => c.Name == "Running club" && c.EventCount == 1);
        }
        using var reopened = StoreTesting.Store(folder);
        await reopened.LoadAsync();
        // The restored calendar and its event are still listed after Thirteen starts again.
        Assert.Contains(reopened.Calendars, c => c.Name == "Running club" && c.EventCount == 1);
    }

    [Fact]
    public async Task ARestoredCalendarIdNeverWritesOutsideTheCalendarsFolder()
    {
        using var root = new TempFolder();
        var calendars = Path.Combine(root.Path, "Calendars");
        var plan = ImportExport.ReadFiles([("Club.ics", Encoding.UTF8.GetBytes(Export("../outside", "Running club", "Club dinner")))], WindowsZoneResolver.Shared);
        Assert.True(plan.IsRestore);
        using var store = new EventStore(calendars, WindowsZoneResolver.Shared, () => Tallinn, new FixedTimeProvider(StoreTesting.Now));
        await store.LoadAsync();
        try
        {
            await ImportExport.RestoreAsync(store, plan.Sources);
        }
        catch (EventStoreException)
        {
            // Refusing the file is fine; writing outside the folder is not.
        }
        // X-THIRTEEN-CALENDAR-ID comes from the file: it must never name a path outside %LOCALAPPDATA%\Thirteen\Calendars.
        Assert.False(File.Exists(Path.Combine(root.Path, "outside.ics")), "the restore wrote " + Path.Combine(root.Path, "outside.ics"));
    }

    // ---- §2.11 Undo: a written change reverts only the field groups it touched ----------------------------------

    [Fact]
    public async Task UndoOfAWrittenMoveRevertsOnlyTheTimeAndKeepsANoteAddedElsewhere()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        using var pending = new PendingChanges(store, store.Clock);
        var history = new UndoHistory(writer, pending);
        var uid = await CreateAsync(writer, Timed(personal, "Dentist", "2026-10-20T10:00", "2026-10-20T11:00"));
        var occurrence = Occurrence(store, uid, "2026-10-20T10:00");
        var move = pending.HoldMove(occurrence, At("2026-10-20T12:00"), At("2026-10-20T13:00"));
        history.RegisterPending(move, "Event moved to 12:00.");
        Assert.True(await pending.CommitAsync(move));                       // the toast timed out: the move is written
        // Another app adds a note (another field group) to the stored file.
        var path = folder.File(personal + ".ics");
        var text = File.ReadAllText(path);
        File.WriteAllText(path, text.Replace("SUMMARY:Dentist\r\n", "SUMMARY:Dentist\r\nDESCRIPTION:Bring the form\r\n", StringComparison.Ordinal));
        Assert.True(await store.CheckOutsideChangeAsync(personal));
        Assert.Equal("Bring the form", store.FindGroup(personal, uid)!.Master!.Description);

        // §2.11: "Undo of a written change reverts only the field groups that change touched, through mergeDraft. If
        // another app changed one of those groups since, nothing is changed" (only then calendar.undoUnavailable).
        var result = await history.UndoAsync();
        Assert.Equal(UndoOutcome.Done, result.Outcome);
        Assert.Equal("2026-10-20T10:00", Year(store).Single(o => o.Uid == uid).Start.ToString());
        Assert.Equal("Bring the form", store.FindGroup(personal, uid)!.Master!.Description);
    }

    // ---- §4.4 Removed and changed occurrences: an override is found by the instant its RECURRENCE-ID names -----

    private const string MixedFormSeries = """
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:-//Other app//EN
        BEGIN:VEVENT
        UID:standup@example.com
        DTSTAMP:20261001T080000Z
        LAST-MODIFIED:20261001T080000Z
        SUMMARY:Standup
        DTSTART;TZID=Europe/Tallinn:20261005T190000
        DTEND;TZID=Europe/Tallinn:20261005T193000
        RRULE:FREQ=WEEKLY;COUNT=4
        END:VEVENT
        BEGIN:VEVENT
        UID:standup@example.com
        DTSTAMP:20261001T080000Z
        LAST-MODIFIED:20261001T080000Z
        RECURRENCE-ID:20261019T160000Z
        SUMMARY:Standup (moved)
        DTSTART;TZID=Europe/Tallinn:20261019T200000
        DTEND;TZID=Europe/Tallinn:20261019T203000
        END:VEVENT
        END:VCALENDAR

        """;

    private static async Task ImportMixedFormSeriesAsync(IEventStore store, string calendarId)
    {
        // RFC 5545 lets RECURRENCE-ID name the instance in UTC while DTSTART has a TZID; 16:00Z is 19:00 in Tallinn.
        var text = MixedFormSeries.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\n", "\r\n", StringComparison.Ordinal);
        var plan = ImportExport.ReadFiles([("standup.ics", Encoding.UTF8.GetBytes(text))], store.Zones);
        await ImportExport.ImportAsync(store, [new ImportChoice(plan.Sources.Single(), ImportTarget.Existing(calendarId))]);
    }

    [Fact]
    public async Task DeletingAChangedEventWhoseRecurrenceIdIsInUtcRemovesIt()
    {
        using var folder = new TempFolder();
        var (store, _, personal) = await OpenAsync(folder);
        using var storeScope = store;
        await ImportMixedFormSeriesAsync(store, personal);
        Assert.Equal(["2026-10-05T19:00", "2026-10-12T19:00", "2026-10-26T19:00"], Starts(store, "Standup"));
        var moved = Occurrence(store, "standup@example.com", "2026-10-19T20:00");
        Assert.Equal("Standup (moved)", moved.Title);
        using var pending = new PendingChanges(store, store.Clock);
        // Delete, "Delete this event only": held, then written when its toast closes.
        Assert.True(await pending.CommitAsync(pending.HoldDelete(moved)));
        Assert.DoesNotContain(Year(store), o => o.Uid == "standup@example.com" && o.Start.Date == new GregorianDate(2026, 10, 19));
        Assert.Empty(store.FindGroup(personal, "standup@example.com")!.Overrides);
    }

    [Fact]
    public async Task MovingAChangedEventWhoseRecurrenceIdIsInUtcKeepsItsOwnFields()
    {
        using var folder = new TempFolder();
        var (store, _, personal) = await OpenAsync(folder);
        using var storeScope = store;
        await ImportMixedFormSeriesAsync(store, personal);
        var moved = Occurrence(store, "standup@example.com", "2026-10-19T20:00");
        using var pending = new PendingChanges(store, store.Clock);
        // Dragged on the timeline to 21:00, "Move this event only".
        Assert.True(await pending.CommitAsync(pending.HoldMove(moved, At("2026-10-19T21:00"), At("2026-10-19T21:30"))));
        var shown = Year(store).Where(o => o.Uid == "standup@example.com" && o.Start.Date == new GregorianDate(2026, 10, 19)).Select(o => $"{o.Start} {o.Title}").ToList();
        Assert.Equal(["2026-10-19T21:00 Standup (moved)"], shown);
        Assert.Single(store.FindGroup(personal, "standup@example.com")!.Overrides);
    }

    // ---- §3.6: a zone only its file defines keeps its meaning when its event moves to another calendar ---------

    private static async Task ImportFixtureAsync(IEventStore store, string calendarId, string file)
    {
        var plan = ImportExport.ReadFiles([(file, File.ReadAllBytes(RepoPaths.Fixture("ics", "imports", file)))], store.Zones);
        await ImportExport.ImportAsync(store, [new ImportChoice(plan.Sources.Single(), ImportTarget.Existing(calendarId))]);
    }

    [Fact]
    public async Task MovingAnEventInAFileDefinedZoneToACalendarWithAnotherZoneOfThatNameKeepsItsTime()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var work = (await store.CreateCalendarAsync("Work")).Id;
        // Two Outlook files, each with its own "Customized Time Zone" (+05:30 Bengaluru, and -03:00/-02:00 Nuuk).
        await ImportFixtureAsync(store, personal, "customized-tz-a.ics");
        await ImportFixtureAsync(store, work, "customized-tz-b.ics");
        var call = Year(store).Single(o => o.Title == "Call with the Bengaluru team");
        Assert.Equal("2026-11-04T12:00", call.Start.ToString());           // 15:30 at +05:30 is 12:00 in Tallinn
        Assert.Equal("2026-11-05T15:00", Year(store).Single(o => o.Title == "Call with Nuuk").Start.ToString());

        // The editor's Calendar field: Personal to Work.
        var resolved = writer.Resolve(call)!;
        await SaveAsync(writer, call, resolved.Draft, resolved.Draft with { CalendarId = work }, EditSpan.All);

        var shown = Year(store).Where(o => o.CalendarId == work).Select(o => $"{o.Start} {o.Title}").Order(StringComparer.Ordinal).ToList();
        Assert.Equal(["2026-11-04T12:00 Call with the Bengaluru team", "2026-11-05T15:00 Call with Nuuk"], shown);
    }

    // ---- §2.16 "Changed outside Thirteen": a file broken from outside never takes back Thirteen's last save -----

    [Fact]
    public async Task AFileLeftHalfWrittenFromOutsideIsNotTakenAsTheCalendar()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        await CreateAsync(writer, Timed(personal, "Dentist", "2026-10-20T10:00", "2026-10-20T11:00"));
        await CreateAsync(writer, Timed(personal, "Haircut", "2026-10-21T10:00", "2026-10-21T11:00"));
        Assert.Equal(2, Year(store).Count);
        // A sync tool leaves the file half written: no END:VCALENDAR, the second VEVENT cut off.
        var path = folder.File(personal + ".ics");
        var text = File.ReadAllText(path);
        File.WriteAllText(path, text[..(text.Length / 2)]);
        await store.CheckOutsideChangeAsync(personal);
        // A truncated document is a file that "cannot be read" (§2.16): Thirteen keeps the events, it does not show an
        // empty calendar and then write that over its backup with the next save.
        Assert.NotEmpty(Year(store));
        await CreateAsync(writer, Timed(personal, "Lunch", "2026-10-22T12:00", "2026-10-22T13:00"));
        Assert.Contains("SUMMARY:Dentist", File.ReadAllText(path) + File.ReadAllText(path + ".bak"));
    }

    [Fact]
    public async Task AFileBrokenFromOutsideKeepsTheLastEventThirteenSaved()
    {
        using var folder = new TempFolder();
        var (store, writer, personal) = await OpenAsync(folder);
        using var storeScope = store;
        await CreateAsync(writer, Timed(personal, "Dentist", "2026-10-20T10:00", "2026-10-20T11:00"));
        await CreateAsync(writer, Timed(personal, "Haircut", "2026-10-21T10:00", "2026-10-21T11:00"));
        // Another app writes something that is not a calendar over the file.
        var path = folder.File(personal + ".ics");
        File.WriteAllText(path, "This is not a calendar\r\n");
        await store.CheckOutsideChangeAsync(personal);
        // The file can't be read, so Thirteen restores a copy (§2.16). The copy Thirteen holds in memory is the one it
        // saved last (the hash it expected); {id}.ics.bak is the version before that, without the haircut.
        Assert.Equal(["Dentist", "Haircut"], Year(store).Select(o => o.Title).Order(StringComparer.Ordinal));
    }

    // ---- §3.5: a series that starts before 1583 is historical, its changed occurrences too ---------------------

    private const string HistoricalSeries = """
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:-//Test//Historical//EN
        BEGIN:VEVENT
        UID:founding@example.com
        DTSTAMP:20261001T080000Z
        DTSTART;VALUE=DATE:15000301
        RRULE:FREQ=YEARLY
        SUMMARY:Founding day
        END:VEVENT
        BEGIN:VEVENT
        UID:founding@example.com
        DTSTAMP:20261001T080000Z
        RECURRENCE-ID;VALUE=DATE:20260301
        DTSTART;VALUE=DATE:20260302
        SUMMARY:Founding day (moved)
        END:VEVENT
        END:VCALENDAR

        """;

    [Fact]
    public async Task AChangedEventOfASeriesFromBefore1583IsReadOnlyAndNeverMoved()
    {
        using var folder = new TempFolder();
        var (store, _, personal) = await OpenAsync(folder);
        using var storeScope = store;
        var text = HistoricalSeries.Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\n", "\r\n", StringComparison.Ordinal);
        var plan = ImportExport.ReadFiles([("founding.ics", Encoding.UTF8.GetBytes(text))], store.Zones);
        await ImportExport.ImportAsync(store, [new ImportChoice(plan.Sources.Single(), ImportTarget.Existing(personal))]);
        var changed = Year(store).Single(o => o.Title == "Founding day (moved)");
        // The views judge it on the series, as the editor does: no drag starts on it.
        Assert.Equal(ReadOnlyReason.Historical, Thirteen.Desktop.ViewModels.EventsModel.ReadOnlyOf(store.Find(personal), changed));
        // And the move itself refuses it as a backstop.
        var calendar = store.Find(personal)!.Document!;
        var refused = Assert.Throws<EventStoreException>(() => EventEdits.MoveOccurrence(
            calendar, store.FindGroup(personal, changed.Uid), changed, At("2026-03-03T00:00"), At("2026-03-04T00:00"), Tallinn, store.Zones, At("2026-10-19T06:41")));
        Assert.Equal(StoreFailure.ReadOnly, refused.Failure);
    }
}
