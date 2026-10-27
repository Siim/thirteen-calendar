using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The Windows editor saves (Services/EventEditing.cs, the port of the web's icsModel; docs/EVENTS.md §2.11, §4.7,
/// §6.4) through <see cref="EventWriter"/> over the mockup data set: a 13-month repeat is written as its RRULE with the
/// marker, "this event only" writes an override, "future events" ends the series and starts a new UID, the first
/// occurrence edits the whole series, a repeat set in another app keeps its stored text, alerts of a series change
/// every member, and the undo stack keeps 20 changes.
/// </summary>
public class EventEditingTests
{
    private static async Task<(FakeEventStore Store, EventWriter Writer)> SetupAsync()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        return (store, new EventWriter(store, store.Clock));
    }

    private static IcsExpandedEvent Occurrence(IEventStore store, string title, string day)
    {
        var date = GregorianDate.ParseIso(day);
        return store.Occurrences(new LocalDateTime(date, 0), new LocalDateTime(date, 1440)).Single(o => o.Title == title);
    }

    private static bool Shows(IEventStore store, string title, string day) =>
        store.Occurrences(new LocalDateTime(GregorianDate.ParseIso(day), 0), new LocalDateTime(GregorianDate.ParseIso(day), 1440)).Any(o => o.Title == title);

    [Fact]
    public async Task ANewThirteenMonthRepeatIsWrittenWithItsMarker()
    {
        var (store, writer) = await SetupAsync();
        var day = new GregorianDate(2026, 10, 19);
        var draft = Drafts.New(day, LocalDateTime.Parse("2026-10-19T09:41"), "home", timeZone: "Europe/Tallinn") with
        {
            Title = "Rent check",
            Recurrence = new EventRecurrence(RepeatRule.Of(ThirteenRule.For(ThirteenRuleKind.Monthly, day, CalendarSystemId.Ifc)!), RepeatEnd.Never),
        };
        var outcome = await writer.RunAsync("home", (ws, ctx) => EventEditing.Create(ws, draft, ctx));
        var group = store.FindGroup("home", outcome.Result.Uid!)!;
        Assert.NotEmpty(group.Master!.RRules);
        Assert.NotNull(group.Master.ThirteenRule);
        Assert.Equal(0, group.Master.Sequence);
        Assert.True(Shows(store, "Rent check", "2026-11-16"));             // IFC November 12
        Assert.False(Shows(store, "Rent check", "2026-11-19"));            // not the Gregorian 19th
        Assert.Single(outcome.Changes);
        Assert.Null(outcome.Changes[0].Before);
    }

    [Fact]
    public async Task ThisEventOnlyWritesAnOverrideAndBumpsTheSequence()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Book club: Cotsworth", "2026-10-19");
        var resolved = writer.Resolve(occurrence)!;
        var draft = resolved.Draft with { Location = "Library" };
        await writer.RunAsync("home", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, draft, EditSpan.This, ctx));
        var group = store.FindGroup("home", "book-club")!;
        var over = Assert.Single(group.Overrides);
        Assert.Equal("Library", over.Location);
        Assert.NotNull(over.RecurrenceId);
        Assert.Equal("Raamatukoi", group.Master!.Location);
        Assert.Equal("Library", Occurrence(store, "Book club: Cotsworth", "2026-10-19").Component.Location);
        Assert.Equal("Raamatukoi", Occurrence(store, "Book club: Cotsworth", "2026-11-16").Component.Location);
    }

    [Fact]
    public async Task FutureEventsEndTheSeriesAndStartANewOne()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Sprint planning", "2026-10-19");
        var resolved = writer.Resolve(occurrence)!;
        var draft = resolved.Draft with { Title = "Planning" };
        var outcome = await writer.RunAsync("work", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, draft, EditSpan.Future, ctx));
        Assert.NotEqual("sprint-planning", outcome.Result.Uid);
        var head = store.FindGroup("work", "sprint-planning")!.Master!;
        Assert.NotNull(Assert.Single(head.RRules).Until);
        Assert.True(Shows(store, "Sprint planning", "2026-10-05"));
        Assert.False(Shows(store, "Sprint planning", "2026-10-19"));
        Assert.True(Shows(store, "Planning", "2026-10-19"));
        Assert.True(Shows(store, "Planning", "2026-11-02"));
    }

    [Fact]
    public async Task TheFirstOccurrenceForFutureEventsEditsTheWholeSeries()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Sprint planning", "2026-01-12");
        var resolved = writer.Resolve(occurrence)!;
        Assert.True(resolved.IsFirst);
        var draft = resolved.Draft with { Start = LocalDateTime.Parse("2026-01-12T10:00"), End = LocalDateTime.Parse("2026-01-12T11:00") };
        var outcome = await writer.RunAsync("work", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, draft, EditSpan.Future, ctx));
        Assert.Equal("sprint-planning", outcome.Result.Uid);                // same UID, retimed in place
        Assert.Equal(LocalDateTime.Parse("2026-10-19T10:00"), Occurrence(store, "Sprint planning", "2026-10-19").Start);
    }

    [Fact]
    public async Task ARepeatSetInAnotherAppIsKeptAsStored()
    {
        var (store, writer) = await SetupAsync();
        var master = StoreTesting.Timed("foreign", "Standup", "2026-10-05T09:00", "2026-10-05T09:15") with
        {
            RRules = [RRule.Parse("FREQ=WEEKLY;BYDAY=MO")],
            Rdates = [new IcsRdate(new IcsDateValue.ZonedValue(LocalDateTime.Parse("2026-10-22T09:00"), "Europe/Tallinn"), null)],
        };
        await StoreTesting.Put(store, "work", master);
        var occurrence = Occurrence(store, "Standup", "2026-10-19");
        var resolved = writer.Resolve(occurrence)!;
        Assert.False(resolved.RepeatEditable);

        // The span question: this event, or all events in place.
        var draft = resolved.Draft with { Title = "Daily standup" };
        var question = SpanQuestions.ForSave(resolved, resolved.Draft, draft);
        Assert.Equal("Its repeat was set in another app. Save your changes for this event only, or for all events?", question.Question.Message);
        Assert.Equal([EditSpan.This, EditSpan.All], question.Spans);
        // A new date applies to this event only.
        var moved = resolved.Draft with { Start = LocalDateTime.Parse("2026-10-20T09:00"), End = LocalDateTime.Parse("2026-10-20T09:15") };
        var dateQuestion = SpanQuestions.ForSave(resolved, resolved.Draft, moved);
        Assert.Equal("Its repeat was set in another app, so a new date can apply to this event only.", dateQuestion.Question.Message);
        Assert.Equal([EditSpan.This], dateQuestion.Spans);

        await writer.RunAsync("work", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, draft, EditSpan.All, ctx));
        var stored = store.FindGroup("work", "foreign")!.Master!;
        Assert.Equal("Daily standup", stored.Summary);
        Assert.Equal("FREQ=WEEKLY;BYDAY=MO", Assert.Single(stored.RRules).ToString());
        Assert.Single(stored.Rdates);
        Assert.True(Shows(store, "Daily standup", "2026-10-22"));
    }

    [Fact]
    public async Task AlertsOfASeriesChangeEveryMember()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Book club: Cotsworth", "2026-10-19");
        var resolved = writer.Resolve(occurrence)!;
        await writer.RunAsync("home", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, resolved.Draft with { Location = "Library" }, EditSpan.This, ctx));
        var again = Occurrence(store, "Book club: Cotsworth", "2026-10-19");
        await writer.RunAsync("home", (ws, ctx) => EventEditing.SetAlarms(ws, again, [new Alarm.RelativeAlarm(-15)], ctx));
        var group = store.FindGroup("home", "book-club")!;
        Assert.All(group.Members, m => Assert.Single(m.Alarms));
    }

    [Fact]
    public async Task DeletingThisOccurrenceOfAChangedOneRemovesItsOverride()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Book club: Cotsworth", "2026-10-19");
        var resolved = writer.Resolve(occurrence)!;
        await writer.RunAsync("home", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, resolved.Draft with { Location = "Library" }, EditSpan.This, ctx));
        var changed = Occurrence(store, "Book club: Cotsworth", "2026-10-19");
        await writer.RunAsync("home", (ws, ctx) => EventEditing.Delete(ws, changed, EditSpan.This, ctx));
        var group = store.FindGroup("home", "book-club")!;
        Assert.Empty(group.Overrides);
        Assert.Single(group.Master!.Exdates);
        Assert.False(Shows(store, "Book club: Cotsworth", "2026-10-19"));
    }

    [Fact]
    public async Task AGoneOccurrenceThrowsChanged()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Dentist, Dr. Tamm", "2026-10-19");
        await store.UpdateDocumentAsync("home", doc => IcsGroups.RemoveGroup(doc, "dentist"));
        var e = await Assert.ThrowsAsync<EventStoreException>(() => writer.RunAsync("home", (ws, ctx) => EventEditing.Delete(ws, occurrence, EditSpan.All, ctx)));
        Assert.Equal(StoreFailure.Changed, e.Failure);
    }

    [Fact]
    public async Task ASubscriptionCannotBeWritten()
    {
        var (store, writer) = await SetupAsync();
        var occurrence = Occurrence(store, "Halloween", "2026-10-31");
        var e = await Assert.ThrowsAsync<EventStoreException>(() => writer.RunAsync("holidays", (ws, ctx) => EventEditing.Delete(ws, occurrence, EditSpan.All, ctx)));
        Assert.Equal(StoreFailure.ReadOnly, e.Failure);
    }

    [Fact]
    public async Task TheUndoStackKeepsTwentyChanges()
    {
        var (store, writer) = await SetupAsync();
        var history = new UndoHistory(writer, null);
        for (var i = 0; i < 25; i++)
        {
            var occurrence = Occurrence(store, i == 0 ? "Dentist, Dr. Tamm" : $"Dentist {i - 1}", "2026-10-19");
            var resolved = writer.Resolve(occurrence)!;
            var outcome = await writer.RunAsync("home", (ws, ctx) => EventEditing.Save(ws, occurrence, resolved.Draft, resolved.Draft with { Title = $"Dentist {i}" }, EditSpan.All, ctx));
            history.RegisterWritten(outcome.Changes);
        }
        Assert.Equal(UndoHistory.Limit, history.Count);
        for (var i = 0; i < 20; i++) Assert.Equal(UndoOutcome.Done, (await history.UndoAsync()).Outcome);
        Assert.Equal(UndoOutcome.Nothing, (await history.UndoAsync()).Outcome);
        Assert.Equal("Dentist 4", store.FindGroup("home", "dentist")!.Master!.Summary);
        Assert.True(history.CanRedo);
        Assert.Equal(UndoOutcome.Done, (await history.RedoAsync()).Outcome);
        Assert.Equal("Dentist 5", store.FindGroup("home", "dentist")!.Master!.Summary);
    }
}
