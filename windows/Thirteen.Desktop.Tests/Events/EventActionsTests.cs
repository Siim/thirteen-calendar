using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The window's event actions (docs/EVENTS.md §2.10, §2.11; task W7) over the mockup data set: details and their
/// actions (historical events keep only Delete and Edit alerts, Duplicate opens an unsaved draft), Add and Save with
/// their spans and toasts, held deletes with Undo, Ctrl+Z and Ctrl+Y, commit failures with Try again, failures recorded
/// for the next start, and the next action closing the toast.
/// </summary>
public class EventActionsTests
{
    private static readonly GregorianDate October19 = new(2026, 10, 19);

    // ---- Details (§2.10) ------------------------------------------------------------------------------------------

    [Fact]
    public async Task DetailsOfAWritableEvent()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.ShowDetailsAsync(f.Item("Dentist, Dr. Tamm"), null);
        var details = Assert.IsType<EventDetailsViewModel>(f.Ui.Details);
        Assert.Equal("Dentist, Dr. Tamm", details.EventTitle);
        Assert.Equal("Thursday, October 12, 2026", details.ThirteenDate);
        Assert.Equal("Monday, October 19, 2026", details.GregorianDate);
        Assert.Contains(details.Lines, l => l.Label == "Time" && l.Value == "15:40 to 16:20");
        Assert.True(details.CanEdit);
        Assert.True(details.CanDelete);
        Assert.False(details.CanEditAlerts);
        Assert.Equal("Home, On this computer", details.CalendarText);
        Assert.Same(f.Item("Dentist, Dr. Tamm").Source.Key, f.Calendar.SelectedItem?.Key);
        AssertNoDashes(details.CopyTexts());
    }

    [Fact]
    public async Task DetailsOfARepeatingEventDescribeTheRepeat()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.ShowDetailsAsync(f.Item("Book club: Cotsworth", "2026-10-19"), null);
        var details = f.Ui.Details!;
        Assert.Contains(details.Lines, l => l.Label == "Repeat" && l.Value == "Every IFC month on the 12th");
    }

    [Fact]
    public async Task DetailsOfASubscribedEventOfferOnlyDuplicate()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.ShowDetailsAsync(f.Item("Halloween", "2026-10-31"), null);
        var details = f.Ui.Details!;
        Assert.False(details.CanEdit);
        Assert.False(details.CanDelete);
        Assert.False(details.CanEditAlerts);
        Assert.True(details.DuplicateCommand.CanExecute(null));
        Assert.NotNull(details.ReadOnlyText);
    }

    [Fact]
    public async Task HistoricalEventsKeepDeleteAndEditAlerts()
    {
        using var f = await EditorFixture.CreateAsync();
        await StoreTesting.Put(f.Fake, "home", StoreTesting.Timed("old", "Battle of Lepanto", "1571-10-07T10:00", "1571-10-07T12:00"));
        var item = f.Item("Battle of Lepanto", "1571-10-07");
        Assert.Equal(ReadOnlyReason.Historical, item.ReadOnly);
        await f.Actions.ShowDetailsAsync(item, null);
        var details = f.Ui.Details!;
        Assert.False(details.CanEdit);
        Assert.True(details.CanEditAlerts);
        Assert.True(details.CanDelete);
        Assert.Equal("Edit alerts", details.EditAlertsText);

        // "Edit alerts": the editor reduced to Alert and Second alert.
        details.EditAlertsCommand.Execute(null);
        await Eventually(() => f.Ui.Editor is not null);
        var editor = f.Ui.Editor!;
        Assert.Equal(EditorMode.Alerts, editor.Mode);
        Assert.Equal("Edit alerts", editor.Title);
        Assert.False(editor.ShowsAllFields);
        editor.SelectedAlert = editor.AlertOptions.First(o => o.Alarm is not null);
        Assert.True(await editor.SaveAsync());
        Assert.NotEmpty(f.Group("home", "old")!.Master!.Alarms);
        // The title and times are untouched.
        Assert.Equal("Battle of Lepanto", f.Group("home", "old")!.Master!.Summary);
    }

    [Fact]
    public async Task HistoricalEventsCanBeDeleted()
    {
        using var f = await EditorFixture.CreateAsync();
        await StoreTesting.Put(f.Fake, "home", StoreTesting.Timed("old", "Battle of Lepanto", "1571-10-07T10:00", "1571-10-07T12:00"));
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Battle of Lepanto", "1571-10-07"), null);
        Assert.Equal("Delete this event?", f.Ui.Questions.Single().Title);
        await f.Actions.NextActionAsync();
        Assert.Null(f.Group("home", "old"));
    }

    [Fact]
    public async Task DuplicateOpensAnUnsavedDraftWithoutTheRepeat()
    {
        using var f = await EditorFixture.CreateAsync();
        var before = f.Fake.Find("home")!.Document!.Groups.Count;
        await f.Actions.DuplicateAsync(f.Item("Book club: Cotsworth"), null, null, null);
        var editor = f.Ui.Editor!;
        Assert.Equal(EditorMode.New, editor.Mode);
        Assert.Equal("New event", editor.Title);
        Assert.Equal("Add", editor.PrimaryText);
        Assert.Equal("Book club: Cotsworth", editor.EventTitle);
        Assert.Null(editor.Draft.Recurrence);
        Assert.Equal("home", editor.Draft.CalendarId);
        Assert.Equal(LocalDateTime.Parse("2026-10-19T19:00"), editor.Draft.Start);
        // Nothing is stored until Add; Cancel leaves no copy behind.
        Assert.Equal(before, f.Fake.Find("home")!.Document!.Groups.Count);
        Assert.True(await editor.RequestCloseAsync());
        Assert.Equal(before, f.Fake.Find("home")!.Document!.Groups.Count);
    }

    [Fact]
    public async Task DuplicateOfASubscribedEventGoesToTheDefaultCalendar()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Shell.State.DefaultCalendarId = "family";
        await f.Actions.DuplicateAsync(f.Item("Halloween", "2026-10-31"), new GregorianDate(2026, 11, 1), null, null);
        var editor = f.Ui.Editor!;
        Assert.Equal("family", editor.Draft.CalendarId);
        Assert.True(editor.Draft.AllDay);
        Assert.Equal(new GregorianDate(2026, 11, 1), editor.Draft.Start.Date);
        Assert.True(await editor.SaveAsync());
        Assert.Contains(f.Fake.Find("family")!.Document!.Groups, g => g.Master?.Summary == "Halloween");
    }

    // ---- Add and Save (§2.11) -------------------------------------------------------------------------------------

    [Fact]
    public async Task NewEventAddsToTheDefaultCalendarWithUndo()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.NewEventAsync(new GregorianDate(2026, 10, 20), 600, 660, null);
        var editor = f.Ui.Editor!;
        Assert.Equal("home", editor.Draft.CalendarId);
        Assert.Equal(LocalDateTime.Parse("2026-10-20T10:00"), editor.Draft.Start);
        Assert.Equal(LocalDateTime.Parse("2026-10-20T11:00"), editor.Draft.End);
        Assert.Equal(Availability.Busy, editor.Draft.Availability);
        editor.EventTitle = "Haircut";
        Assert.True(await editor.SaveAsync());
        Assert.True(f.Shows("Haircut", "2026-10-20"));
        var toast = f.Actions.Toast!;
        Assert.Equal("Event saved.", toast.Message);
        Assert.Equal("Undo", toast.ActionText);
        Assert.Equal("Event saved. Undo available: Control Z.", toast.Announcement);
        Assert.Contains(f.Ui.Focused, x => x.CalendarId == "home");

        await f.Actions.UndoAsync();
        Assert.False(f.Shows("Haircut", "2026-10-20"));
        await f.Actions.RedoAsync();
        Assert.True(f.Shows("Haircut", "2026-10-20"));
    }

    [Fact]
    public async Task AnEmptyTitleIsSavedAsNewEvent()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.NewEventAsync(October19, null, null, null);
        var editor = f.Ui.Editor!;
        Assert.True(editor.Draft.AllDay);
        Assert.Equal(Availability.Free, editor.Draft.Availability);
        Assert.True(await editor.SaveAsync());
        Assert.True(f.Shows("New event"));
    }

    [Fact]
    public async Task NoLocalCalendarLeftCreatesPersonalOnTheNextPlus()
    {
        using var f = await EditorFixture.CreateAsync();
        foreach (var id in new[] { "home", "family", "work", "running-club" }) await f.Fake.DeleteCalendarAsync(id);
        await f.Actions.NewEventAsync(October19, 600, 660, null);
        var editor = f.Ui.Editor!;
        Assert.Equal("Personal", f.Fake.Find(editor.Draft.CalendarId)!.Name);
    }

    [Fact]
    public async Task SavingASingleEventIsUndoable()
    {
        using var f = await EditorFixture.CreateAsync();
        var before = f.Group("home", "dentist")!;
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        Assert.Equal("Edit event", editor.Title);
        editor.EventTitle = "Dentist";
        Assert.True(await editor.SaveAsync());
        Assert.Empty(f.Ui.Questions);
        Assert.Equal("Dentist", f.Group("home", "dentist")!.Master!.Summary);
        Assert.Equal("Undo", f.Actions.Toast!.ActionText);

        // Ctrl+Z writes the previous version back exactly.
        await f.Actions.UndoAsync();
        Assert.True(EventWriter.SameGroup(before, f.Group("home", "dentist")));
    }

    [Fact]
    public async Task UndoIsUnavailableAfterAChangeElsewhere()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        f.Ui.Editor!.Location = "Tartu";
        Assert.True(await f.Ui.Editor.SaveAsync());
        // Another app changes the field group the save touched (§2.11: only then is the undo unavailable).
        await f.Fake.UpdateGroupAsync("home", "dentist", (_, g) => g! with { Master = g.Master! with { Location = "Changed elsewhere", Raw = null } });
        await f.Actions.UndoAsync();
        Assert.Equal("This event changed in another app, so it can't be undone.", f.Actions.Toast!.Message);
        Assert.Equal("Changed elsewhere", f.Group("home", "dentist")!.Master!.Location);
    }

    [Fact]
    public async Task SavingThisOccurrenceOnlyAsksAndIsUndoable()
    {
        using var f = await EditorFixture.CreateAsync();
        var before = f.Group("work", "sprint-planning")!;
        await f.Actions.EditAsync(f.Item("Sprint planning"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Sprint planning (moved room)";
        f.Ui.Answers.Enqueue(0);
        Assert.True(await editor.SaveAsync());
        var question = f.Ui.Questions.Single();
        Assert.Equal("This is a repeating event.", question.Title);
        Assert.Equal("Save your changes for this event only, or for this and all future events?", question.Message);
        Assert.Equal(["Save for this event only", "Save for future events"], question.Choices.Select(c => c.Text));
        Assert.Single(f.Group("work", "sprint-planning")!.Overrides, o => o.Summary == "Sprint planning (moved room)");
        Assert.Equal("Undo", f.Actions.Toast!.ActionText);
        await f.Actions.UndoAsync();
        Assert.True(EventWriter.SameGroup(before, f.Group("work", "sprint-planning")));
    }

    [Fact]
    public async Task SavingFutureEventsSplitsTheSeriesWithoutUndo()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Sprint planning"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Planning";
        f.Ui.Answers.Enqueue(1);
        Assert.True(await editor.SaveAsync());
        var toast = f.Actions.Toast!;
        Assert.Equal("Event saved.", toast.Message);
        Assert.False(toast.HasAction);
        Assert.Equal(0, f.Actions.History.Count);
        // Earlier occurrences keep the old title, this one and later ones the new.
        Assert.True(f.Shows("Planning", "2026-10-19"));
        Assert.True(f.Shows("Sprint planning", "2026-10-05"));
        Assert.True(f.Shows("Planning", "2026-11-02"));
    }

    [Fact]
    public async Task CancelOnTheSpanQuestionSavesNothing()
    {
        using var f = await EditorFixture.CreateAsync();
        var before = f.Group("work", "sprint-planning")!;
        await f.Actions.EditAsync(f.Item("Sprint planning"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Planning";
        Assert.False(await editor.SaveAsync());
        Assert.False(editor.IsClosed);
        Assert.Same(before, f.Group("work", "sprint-planning"));
    }

    [Fact]
    public async Task MovingAnEventToAnotherCalendar()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        editor.SelectedCalendar = editor.Calendars.Single(c => c.Id == "family");
        Assert.True(await editor.SaveAsync());
        Assert.Null(f.Group("home", "dentist"));
        Assert.Equal("family", f.Item("Dentist, Dr. Tamm").CalendarId);
        // Undo puts it back in Home.
        await f.Actions.UndoAsync();
        Assert.NotNull(f.Group("home", "dentist"));
        Assert.Equal("home", f.Item("Dentist, Dr. Tamm").CalendarId);
    }

    [Fact]
    public async Task AnOccurrenceGoneAtSaveTimeSavesNothing()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Dentist";
        // Another app retimes the event: the occurrence no longer resolves.
        await StoreTesting.Put(f.Fake, "home", StoreTesting.Timed("dentist", "Dentist, Dr. Tamm", "2026-11-02T10:00", "2026-11-02T11:00", 4));
        Assert.False(await editor.SaveAsync());
        Assert.Equal("This event changed in another app. Open it again to edit it.", Assert.Single(f.Ui.Alerts));
        Assert.True(editor.IsClosed);
        Assert.Equal("Dentist, Dr. Tamm", f.Group("home", "dentist")!.Master!.Summary);
    }

    [Fact]
    public async Task TheEditorClosesWhenItsEventIsDeletedElsewhere()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        await f.Fake.UpdateDocumentAsync("home", doc => IcsGroups.RemoveGroup(doc, "dentist"));
        await Eventually(() => editor.IsClosed);
        Assert.Equal("This event was deleted in another app.", Assert.Single(f.Ui.Alerts));
    }

    [Fact]
    public async Task TheEditorShowsTheBannerWhenTheSameGroupChangedElsewhere()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Dentist (mine)";
        await f.Fake.UpdateGroupAsync("home", "dentist", (_, g) => g! with { Master = g.Master! with { Summary = "Dentist (theirs)", Sequence = g.Master.Sequence + 1, Raw = null } });
        await Eventually(() => editor.ChangedElsewhere);
        Assert.Equal("This event changed in another app. Your changes win where you both changed the same detail.", editor.ChangedElsewhereText);
        Assert.True(await editor.SaveAsync());
        Assert.Equal("Dentist (mine)", f.Group("home", "dentist")!.Master!.Summary);
    }

    [Fact]
    public async Task AChangeElsewhereToAnotherGroupShowsNoBannerAndIsKept()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Dentist (mine)";
        await f.Fake.UpdateGroupAsync("home", "dentist", (_, g) => g! with { Master = g.Master! with { Location = "Tartu", Sequence = g.Master.Sequence + 1, Raw = null } });
        Assert.False(editor.ChangedElsewhere);
        Assert.True(await editor.SaveAsync());
        var master = f.Group("home", "dentist")!.Master!;
        Assert.Equal("Dentist (mine)", master.Summary);
        Assert.Equal("Tartu", master.Location);
    }

    // ---- Delete and Undo (§2.11) ----------------------------------------------------------------------------------

    [Fact]
    public async Task DeleteIsHeldUntilTheToastCloses()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        var question = f.Ui.Questions.Single();
        Assert.Equal("Delete this event?", question.Title);
        Assert.Equal(["Delete event"], question.Choices.Select(c => c.Text));
        Assert.Equal(ChoiceStyle.Destructive, question.Choices[0].Style);
        Assert.False(f.Shows("Dentist, Dr. Tamm"));                 // gone from the views at once
        Assert.NotNull(f.Group("home", "dentist"));                   // nothing written yet
        var toast = f.Actions.Toast!;
        Assert.Equal("Event deleted.", toast.Message);
        Assert.Equal("Event deleted. Undo available: Control Z.", toast.Announcement);
        Assert.Equal("Close", toast.CloseText);

        // Close commits; it never undoes.
        await toast.CloseAsync();
        Assert.Null(f.Group("home", "dentist"));
        Assert.Null(f.Actions.Toast);
    }

    [Fact]
    public async Task UndoWhileAHeldDeleteIsPendingWritesNothing()
    {
        using var f = await EditorFixture.CreateAsync();
        var before = f.Group("home", "dentist");
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        await f.Actions.Toast!.ActionCommand.ExecuteAsync(null);
        Assert.True(f.Shows("Dentist, Dr. Tamm"));
        Assert.Same(before, f.Group("home", "dentist"));
        Assert.Null(f.Actions.Toast);
        Assert.Contains(("home", "dentist"), f.Ui.Focused);
    }

    [Fact]
    public async Task CtrlZUndoesTheHeldDeleteAndCtrlYHoldsItAgain()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        await f.Actions.UndoAsync();
        Assert.True(f.Shows("Dentist, Dr. Tamm"));
        Assert.NotNull(f.Group("home", "dentist"));
        await f.Actions.RedoAsync();
        Assert.False(f.Shows("Dentist, Dr. Tamm"));
        Assert.Equal("Event deleted.", f.Actions.Toast!.Message);
        await f.Actions.NextActionAsync();
        Assert.Null(f.Group("home", "dentist"));
    }

    [Fact]
    public async Task AWrittenDeleteIsStillUndoable()
    {
        using var f = await EditorFixture.CreateAsync();
        var before = f.Group("home", "dentist");
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        await f.Actions.NextActionAsync();                         // written
        Assert.Null(f.Group("home", "dentist"));
        await f.Actions.UndoAsync();
        Assert.True(EventWriter.SameGroup(before, f.Group("home", "dentist")));
    }

    [Fact]
    public async Task DeletingOneOccurrenceAsksForTheSpan()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Sprint planning"), null);
        var question = f.Ui.Questions.Single();
        Assert.Equal("This is a repeating event.", question.Title);
        Assert.Equal("Delete this event only, or this and all future events?", question.Message);
        Assert.Equal(["Delete this event only", "Delete all future events"], question.Choices.Select(c => c.Text));
        Assert.False(f.Shows("Sprint planning"));
        Assert.True(f.Shows("Sprint planning", "2026-11-02"));
        await f.Actions.NextActionAsync();
        Assert.NotEmpty(f.Group("work", "sprint-planning")!.Master!.Exdates);
    }

    [Fact]
    public async Task DeletingAllFutureEventsIsWrittenAtOnceWithoutUndo()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Ui.Answers.Enqueue(1);
        await f.Actions.DeleteAsync(f.Item("Sprint planning"), null);
        Assert.False(f.Shows("Sprint planning"));
        Assert.False(f.Shows("Sprint planning", "2026-11-02"));
        Assert.True(f.Shows("Sprint planning", "2026-10-05"));
        var toast = f.Actions.Toast!;
        Assert.Equal("Event deleted.", toast.Message);
        Assert.False(toast.HasAction);
        Assert.Equal(0, f.Actions.History.Count);
    }

    [Fact]
    public async Task DeleteFromTheEditorAsksThenClosesIt()
    {
        using var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        f.Ui.Answers.Enqueue(0);
        editor.DeleteCommand.Execute(null);
        await Eventually(() => editor.IsClosed);
        Assert.False(f.Shows("Dentist, Dr. Tamm"));
        Assert.Equal("Event deleted.", f.Actions.Toast!.Message);
    }

    // ---- The next action (§2.11 "Toast timing") -------------------------------------------------------------------

    [Fact]
    public async Task PagingClosesTheToastAndCommits()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        f.Calendar.Page(1);
        await Eventually(() => f.Group("home", "dentist") is null);
        Assert.Null(f.Actions.Toast);
    }

    [Fact]
    public async Task OpeningDetailsClosesTheToastAndCommits()
    {
        using var f = await EditorFixture.CreateAsync();
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        await f.Actions.ShowDetailsAsync(f.Item("Sprint planning"), null);
        Assert.Null(f.Group("home", "dentist"));
    }

    [Fact]
    public async Task AToastWithAnActionStaysWhileAScreenReaderRuns()
    {
        using var f = await EditorFixture.CreateAsync(screenReader: true);
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        Assert.True(f.Actions.Toast!.StaysUntilNextAction);
        f.Actions.ShowMessage("Event moved to 14:00.");
        Assert.False(f.Actions.Toast!.StaysUntilNextAction);       // no action, so it times out
    }

    // ---- Commit failures (§2.11) ----------------------------------------------------------------------------------

    [Fact]
    public async Task AFailedCommitGoesBackAndOffersTryAgain()
    {
        FlakyStore? flaky = null;
        using var f = await EditorFixture.CreateAsync(store => flaky = new FlakyStore(store));
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        flaky!.TransientFailures = 2;                                  // the write and its one retry fail
        await f.Actions.NextActionAsync();
        Assert.True(f.Shows("Dentist, Dr. Tamm"));                     // back at the stored state
        var toast = f.Actions.Toast!;
        Assert.Equal("Couldn't delete the event.", toast.Message);
        Assert.Equal("Try again", toast.ActionText);
        Assert.Equal("Couldn't delete the event.", toast.Announcement);

        // Try again writes at once.
        await toast.ActionCommand.ExecuteAsync(null);
        Assert.Null(f.Group("home", "dentist"));
    }

    [Fact]
    public async Task TryAgainThatFailsAgainHasNoSecondTryAgain()
    {
        FlakyStore? flaky = null;
        using var f = await EditorFixture.CreateAsync(store => flaky = new FlakyStore(store));
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        flaky!.TransientFailures = 4;
        await f.Actions.NextActionAsync();
        await f.Actions.Toast!.ActionCommand.ExecuteAsync(null);
        var toast = f.Actions.Toast!;
        Assert.Equal("Couldn't delete the event.", toast.Message);
        Assert.False(toast.HasAction);
        Assert.NotNull(f.Group("home", "dentist"));
    }

    [Fact]
    public async Task AReadOnlyFailureSaysWhyWithoutTryAgain()
    {
        FlakyStore? flaky = null;
        using var f = await EditorFixture.CreateAsync(store => flaky = new FlakyStore(store));
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        flaky!.Failure = StoreFailure.ReadOnly;
        flaky.TransientFailures = 1;
        await f.Actions.NextActionAsync();
        var toast = f.Actions.Toast!;
        Assert.Equal("Couldn't delete the event. This calendar can't be changed. Choose another calendar.", toast.Message);
        Assert.False(toast.HasAction);
    }

    [Fact]
    public async Task ASaveThatFailsShowsTheReasonAndKeepsTheEditorOpen()
    {
        FlakyStore? flaky = null;
        using var f = await EditorFixture.CreateAsync(store => flaky = new FlakyStore(store));
        await f.Actions.EditAsync(f.Item("Dentist, Dr. Tamm"), null);
        var editor = f.Ui.Editor!;
        editor.EventTitle = "Dentist";
        flaky!.TransientFailures = 1;
        Assert.False(await editor.SaveAsync());
        Assert.False(editor.IsClosed);
        Assert.True(editor.HasSaveError);
        Assert.Equal("Couldn't save the event", editor.SaveErrorTitle);
        Assert.Equal("Please try again.", editor.SaveErrorReason);
        Assert.Equal("EventStore Transient", editor.SaveErrorCode);
        Assert.True(await editor.SaveAsync());
        Assert.Equal("Dentist", f.Group("home", "dentist")!.Master!.Summary);
    }

    [Fact]
    public async Task AFailureWhileInTheBackgroundIsRecordedAndShownOnReturn()
    {
        FlakyStore? flaky = null;
        using var f = await EditorFixture.CreateAsync(store => flaky = new FlakyStore(store));
        f.Ui.Answers.Enqueue(0);
        await f.Actions.DeleteAsync(f.Item("Dentist, Dr. Tamm"), null);
        f.Pending!.IsForeground = () => false;
        flaky!.TransientFailures = 2;
        await f.Pending.CommitAsync(f.Actions.Toast!.Change!);
        Assert.Null(f.Actions.Toast);                                       // its toast goes; no failure toast nobody sees
        Assert.True(f.Shows("Dentist, Dr. Tamm"));
        Assert.Single(f.Fake.FailedCommits);

        // Back in the foreground (the window's Activated): the recorded failure's toast.
        f.Pending.IsForeground = () => true;
        await f.Actions.NextActionAsync();
        f.Actions.CheckRecordedFailures();
        Assert.Equal("Couldn't delete “Dentist, Dr. Tamm” on Thursday, October 12, 2026.", f.Actions.Toast!.Message);
        Assert.Equal("Try again", f.Actions.Toast.ActionText);
        await f.Actions.Toast.ActionCommand.ExecuteAsync(null);
        Assert.Null(f.Group("home", "dentist"));
        Assert.Empty(f.Fake.FailedCommits);
    }

    [Fact]
    public async Task FailuresNobodySawShowAtTheNextStart()
    {
        using var f = await EditorFixture.CreateAsync();
        var dentist = f.Item("Dentist, Dr. Tamm").Source;
        var record = new FailedCommit
        {
            Key = dentist.Key,
            Title = dentist.Title,
            Change = new FailedChange { Kind = "move", Date = "2026-10-20", Minute = 14 * 60 },
            Cause = "transient",
        };
        await f.Fake.AddFailedCommitsAsync([record]);
        f.Actions.CheckRecordedFailures();
        var toast = f.Actions.Toast!;
        Assert.Equal("Couldn't move “Dentist, Dr. Tamm” to Friday, October 13, 2026 at 14:00.", toast.Message);
        Assert.Equal("Try again", toast.ActionText);
        await toast.ActionCommand.ExecuteAsync(null);
        Assert.Empty(f.Fake.FailedCommits);
        Assert.True(f.Shows("Dentist, Dr. Tamm", "2026-10-20"));
        Assert.Equal(LocalDateTime.Parse("2026-10-20T14:00"), f.Item("Dentist, Dr. Tamm", "2026-10-20").Start);
    }

    [Fact]
    public async Task SeveralFailuresNobodySawOpenTheList()
    {
        using var f = await EditorFixture.CreateAsync();
        var dentist = f.Item("Dentist, Dr. Tamm").Source;
        var sprint = f.Item("Sprint planning").Source;
        await f.Fake.AddFailedCommitsAsync(
        [
            new FailedCommit { Key = dentist.Key, Title = dentist.Title, Change = new FailedChange { Kind = "delete", Date = "2026-10-19" }, Cause = "changed" },
            new FailedCommit { Key = sprint.Key, Title = sprint.Title, Change = new FailedChange { Kind = "move", Date = "2026-10-21", AllDay = false, Minute = 600 }, Cause = "transient" },
        ]);
        f.Actions.CheckRecordedFailures();
        var toast = f.Actions.Toast!;
        Assert.Equal("2 changes couldn't be saved.", toast.Message);
        Assert.Equal("Show", toast.ActionText);
        await toast.ActionCommand.ExecuteAsync(null);
        var list = f.Ui.FailedList!;
        Assert.Equal("Changes that couldn't be saved", list.Title);
        Assert.Equal(2, list.Rows.Count);
        Assert.Equal("Couldn't delete “Dentist, Dr. Tamm” on Thursday, October 12, 2026. It changed in another app.", list.Rows[0].Text);
        Assert.False(list.Rows[0].CanRetry);
        Assert.True(list.Rows[1].CanRetry);
        Assert.Empty(f.Fake.FailedCommits);                           // cleared when the list opens
        AssertNoDashes(list.CopyTexts());

        // A row opens its event's details.
        await list.Rows[0].OpenCommand.ExecuteAsync(null);
        Assert.Equal("Dentist, Dr. Tamm", f.Ui.Details!.EventTitle);
    }

    [Fact]
    public async Task ARecordedFailureToastClosedClearsTheRecords()
    {
        using var f = await EditorFixture.CreateAsync();
        var dentist = f.Item("Dentist, Dr. Tamm").Source;
        await f.Fake.AddFailedCommitsAsync([new FailedCommit { Key = dentist.Key, Title = dentist.Title, Change = new FailedChange { Kind = "delete", Date = "2026-10-19" }, Cause = "readOnly" }]);
        f.Actions.CheckRecordedFailures();
        Assert.Equal("Show event", f.Actions.Toast!.ActionText);
        await f.Actions.Toast.CloseAsync();
        Assert.Empty(f.Fake.FailedCommits);
    }

    // ---- Drag edits (task W6's feedback seam) ---------------------------------------------------------------------

    [Fact]
    public async Task AHeldMoveSharesTheToastAndTheUndoStack()
    {
        using var f = await EditorFixture.CreateAsync();
        var change = f.Pending!.HoldMove(f.Item("Dentist, Dr. Tamm").Source, LocalDateTime.Parse("2026-10-19T14:00"), LocalDateTime.Parse("2026-10-19T14:40"));
        f.Actions.MoveHeld(change, "Event moved to 14:00.", null);
        Assert.Equal("Event moved to 14:00.", f.Actions.Toast!.Message);
        Assert.Equal(1, f.Actions.History.Count);
        await f.Actions.UndoAsync();
        Assert.Equal(PendingState.Discarded, change.State);
        Assert.Equal(LocalDateTime.Parse("2026-10-19T15:40"), f.Item("Dentist, Dr. Tamm").Start);
    }

    private static void AssertNoDashes(IEnumerable<string?> texts)
    {
        foreach (var text in texts.Where(t => t is not null))
        {
            Assert.False(text!.Contains('–') || text.Contains('—'), $"A dash in: {text}");
        }
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++) await Task.Delay(10);
        Assert.True(condition());
    }
}
