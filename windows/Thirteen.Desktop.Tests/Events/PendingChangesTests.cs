using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>A store whose document writes fail on demand (an I/O error, or a read-only calendar).</summary>
internal sealed class FlakyStore(IEventStore inner) : IEventStore
{
    public int TransientFailures { get; set; }

    public StoreFailure Failure { get; set; } = StoreFailure.Transient;

    public int Writes { get; private set; }

    public IZoneResolver Zones => inner.Zones;

    public string DeviceZone => inner.DeviceZone;

    public CalendarSystemId System { get => inner.System; set => inner.System = value; }

    public bool IsLoaded => inner.IsLoaded;

    public string? Folder => inner.Folder;

    public IReadOnlyList<CalendarState> Calendars => inner.Calendars;

    public IReadOnlyList<FailedCommit> FailedCommits => inner.FailedCommits;

    public IReadOnlyList<string> CollapsedGroups => inner.CollapsedGroups;

    public event EventHandler<StoreChangedEventArgs>? Changed
    {
        add => inner.Changed += value;
        remove => inner.Changed -= value;
    }

    public event Action<string>? ReloadedFromDisk
    {
        add => inner.ReloadedFromDisk += value;
        remove => inner.ReloadedFromDisk -= value;
    }

    public Func<string, Task>? BeforeWrite { get => inner.BeforeWrite; set => inner.BeforeWrite = value; }

    public Task LoadAsync(CancellationToken cancellationToken = default) => inner.LoadAsync(cancellationToken);

    public CalendarState? Find(string calendarId) => inner.Find(calendarId);

    public IReadOnlyList<IcsExpandedEvent> Occurrences(LocalDateTime from, LocalDateTime to, bool includeHidden = false) => inner.Occurrences(from, to, includeHidden);

    public IcsGroup? FindGroup(string calendarId, string uid) => inner.FindGroup(calendarId, uid);

    public Task<IcsCalendar> UpdateDocumentAsync(string calendarId, Func<IcsCalendar, IcsCalendar> change, CancellationToken cancellationToken = default)
    {
        Writes++;
        if (TransientFailures > 0)
        {
            TransientFailures--;
            throw new EventStoreException(Failure, "injected failure");
        }
        return inner.UpdateDocumentAsync(calendarId, change, cancellationToken);
    }

    public Task<IcsCalendar> UpdateGroupAsync(string calendarId, string uid, Func<IcsCalendar, IcsGroup?, IcsGroup?> change, CancellationToken cancellationToken = default) =>
        inner.UpdateGroupAsync(calendarId, uid, change, cancellationToken);

    public Task<CalendarState> CreateCalendarAsync(string name, string? color = null, string? id = null, CancellationToken cancellationToken = default) =>
        inner.CreateCalendarAsync(name, color, id, cancellationToken);

    public Task<CalendarState> EnsureLocalCalendarAsync(CancellationToken cancellationToken = default) => inner.EnsureLocalCalendarAsync(cancellationToken);

    public Task<CalendarState> CreateSubscriptionAsync(string name, string color, SubscriptionRecord subscription, string body, string? id = null, CancellationToken cancellationToken = default) =>
        inner.CreateSubscriptionAsync(name, color, subscription, body, id, cancellationToken);

    public Task DeleteCalendarAsync(string calendarId, CancellationToken cancellationToken = default) => inner.DeleteCalendarAsync(calendarId, cancellationToken);

    public Task<CalendarState> UpdateRecordAsync(string calendarId, Func<CalendarRecord, CalendarRecord> change, CancellationToken cancellationToken = default) =>
        inner.UpdateRecordAsync(calendarId, change, cancellationToken);

    public Task<bool> UpdateSubscriptionAsync(string calendarId, Func<CalendarRecord, SubscriptionUpdate?> decide, CancellationToken cancellationToken = default) =>
        inner.UpdateSubscriptionAsync(calendarId, decide, cancellationToken);

    public Task SetCollapsedAsync(string group, bool collapsed, CancellationToken cancellationToken = default) => inner.SetCollapsedAsync(group, collapsed, cancellationToken);

    public Task AddFailedCommitsAsync(IReadOnlyList<FailedCommit> failures, CancellationToken cancellationToken = default) => inner.AddFailedCommitsAsync(failures, cancellationToken);

    public Task ClearFailedCommitsAsync(CancellationToken cancellationToken = default) => inner.ClearFailedCommitsAsync(cancellationToken);
}

/// <summary>
/// <see cref="PendingChanges"/> (§2.11, §6.4 "Tests"): failed commits reverted and reported, failures nobody saw shown
/// at the next start, early commits keep an exact undo, the next action and Close commit, an alert a minute away
/// commits.
/// </summary>
public class PendingChangesTests
{
    private static readonly LocalDateTime Day19 = LocalDateTime.Parse("2026-10-19T00:00");
    private static readonly LocalDateTime Day20 = LocalDateTime.Parse("2026-10-20T00:00");

    private static async Task<(FakeEventStore Fake, FlakyStore Store, FixedTimeProvider Time)> Setup()
    {
        var time = new FixedTimeProvider(StoreTesting.Now);
        var fake = new FakeEventStore(time: time);
        await fake.LoadAsync();
        return (fake, new FlakyStore(fake), time);
    }

    private static IcsExpandedEvent Occurrence(IEventStore store, string title) =>
        store.Occurrences(Day19, Day20).Single(o => o.Title == title);

    [Fact]
    public async Task AMoveIsShownPendingAndWrittenWhenItsToastCloses()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var dentist = Occurrence(store, "Dentist, Dr. Tamm");
        var change = pending.HoldMove(dentist, LocalDateTime.Parse("2026-10-20T15:00"), LocalDateTime.Parse("2026-10-20T15:40"));
        Assert.Equal(PendingState.Pending, change.State);
        Assert.Same(change, Assert.Single(pending.Pending));
        Assert.Equal(0, store.Writes);

        Assert.True(await pending.CommitAsync(change));
        Assert.Equal(PendingState.Written, change.State);
        Assert.Empty(pending.Pending);
        var moved = fake.Occurrences(Day20, LocalDateTime.Parse("2026-10-21T00:00")).Single(o => o.Title == "Dentist, Dr. Tamm");
        Assert.Equal(LocalDateTime.Parse("2026-10-20T15:00"), moved.Start);
        Assert.Equal(LocalDateTime.Parse("2026-10-20T15:40"), moved.End);
        Assert.Equal(1, fake.FindGroup("home", "dentist")!.Master!.Sequence);
    }

    [Fact]
    public async Task UndoWhilePendingWritesNothing()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var change = pending.HoldDelete(Occurrence(store, "Dentist, Dr. Tamm"));
        Assert.True(pending.Discard(change));
        Assert.Equal(PendingState.Discarded, change.State);
        await pending.CloseAsync();
        Assert.Equal(0, store.Writes);
        Assert.NotNull(fake.FindGroup("home", "dentist"));
    }

    [Fact]
    public async Task OneTransientFailureIsRetriedAtOnce()
    {
        var (_, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var change = pending.HoldDelete(Occurrence(store, "Dentist, Dr. Tamm"));
        store.TransientFailures = 1;
        Assert.True(await pending.CommitAsync(change));
        Assert.Equal(2, store.Writes);
        Assert.Null(store.FindGroup("home", "dentist"));
    }

    [Fact]
    public async Task AFailedCommitIsRevertedAndReportedWithTryAgainAndNoReasonLine()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var failures = new List<CommitFailure>();
        pending.Failed += failures.Add;
        var change = pending.HoldMove(Occurrence(store, "Dentist, Dr. Tamm"), LocalDateTime.Parse("2026-10-20T15:00"), LocalDateTime.Parse("2026-10-20T15:40"));
        store.TransientFailures = 2;

        Assert.False(await pending.CommitAsync(change));
        var failure = Assert.Single(failures);
        Assert.Equal(PendingState.Failed, change.State);
        Assert.Empty(pending.Pending);                       // the views show the stored state again
        Assert.Equal(CommitCause.Transient, failure.Cause);
        Assert.True(failure.Seen);
        Assert.True(failure.CanRetry);
        Assert.Equal("Couldn't move the event.", failure.Message);
        Assert.Equal(LocalDateTime.Parse("2026-10-19T15:40"), Occurrence(fake, "Dentist, Dr. Tamm").Start);
        Assert.Empty(fake.FailedCommits);                    // seen: nothing recorded for later

        // Try again writes at once.
        Assert.True(await pending.RetryAsync(failure));
        Assert.Equal(PendingState.Written, change.State);
    }

    [Fact]
    public async Task AFinalCauseAndAChangedEventSayWhy()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var failures = new List<CommitFailure>();
        pending.Failed += failures.Add;

        var delete = pending.HoldDelete(Occurrence(store, "Dentist, Dr. Tamm"));
        store.Failure = StoreFailure.ReadOnly;
        store.TransientFailures = 1;
        Assert.False(await pending.CommitAsync(delete));
        Assert.Equal(1, store.Writes);                        // a final cause is not retried
        Assert.Equal("Couldn't delete the event. This calendar can't be changed. Choose another calendar.", failures[^1].Message);
        Assert.False(failures[^1].CanRetry);

        var move = pending.HoldMove(Occurrence(store, "Dentist, Dr. Tamm"), LocalDateTime.Parse("2026-10-20T15:00"), LocalDateTime.Parse("2026-10-20T15:40"));
        using (EventStoreBase.WithoutBeforeWrite())
        {
            // Deleted outside this window meanwhile (as a file changed outside Thirteen would be).
            await fake.UpdateGroupAsync("home", "dentist", (_, _) => null);
        }
        Assert.Equal(PendingState.Pending, move.State);
        Assert.False(await pending.CommitAsync(move));
        Assert.Equal(CommitCause.Changed, failures[^1].Cause);
        Assert.Equal("This event changed in another app, so it wasn't moved.", failures[^1].Message);
    }

    [Fact]
    public async Task AFailureOnCloseIsShownAtTheNextStartByName()
    {
        EventStrings.Use24Hour = true;
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        pending.HoldMove(Occurrence(store, "Dentist, Dr. Tamm"), LocalDateTime.Parse("2026-10-20T15:00"), LocalDateTime.Parse("2026-10-20T15:40"));
        store.TransientFailures = 2;
        await pending.CloseAsync();

        var recorded = Assert.Single(fake.FailedCommits);
        Assert.Equal("home/dentist|2026-10-19T15:40", recorded.Key);
        Assert.Equal("transient", recorded.Cause);
        Assert.Equal(
            "Couldn't move “Dentist, Dr. Tamm” to Friday, October 13, 2026 at 15:00.",
            PendingChanges.LaterMessage(fake.FailedCommits, CalendarSystemId.Ifc));
        Assert.Equal("Try again", PendingChanges.LaterAction(fake.FailedCommits));

        // A second failure nobody saw: one toast for both, with Show.
        using var second = new PendingChanges(store);
        second.HoldDelete(Occurrence(store, "Book club: Cotsworth"));
        store.TransientFailures = 2;
        await second.CloseAsync();
        Assert.Equal(2, fake.FailedCommits.Count);
        Assert.Equal("2 changes couldn't be saved.", PendingChanges.LaterMessage(fake.FailedCommits, CalendarSystemId.Ifc));
        Assert.Equal("Show", PendingChanges.LaterAction(fake.FailedCommits));
        Assert.Equal("Couldn't delete “Book club: Cotsworth” on Thursday, October 12, 2026.", PendingChanges.LaterRow(fake.FailedCommits[1], CalendarSystemId.Ifc));

        await fake.ClearFailedCommitsAsync();
        Assert.Null(PendingChanges.LaterMessage(fake.FailedCommits, CalendarSystemId.Ifc));
    }

    [Fact]
    public void LaterRowsOfAllDayMovesAndChangedEventsReadAsTheCatalogue()
    {
        var allDay = new FailedCommit
        {
            Key = "family/school-break|2026-10-19",
            Title = "Autumn school break",
            Change = new FailedChange { Kind = "move", Date = "2026-12-31", AllDay = true },
            Cause = "changed",
        };
        Assert.Equal("Couldn't move “Autumn school break” to Year Day 2026. It changed in another app.", PendingChanges.LaterRow(allDay, CalendarSystemId.Ifc));
        Assert.Equal("Show event", PendingChanges.LaterAction([allDay]));
    }

    [Fact]
    public async Task AnEarlyCommitKeepsAnExactUndo()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var before = fake.FindGroup("home", "dentist")!;
        var change = pending.HoldDelete(Occurrence(store, "Dentist, Dr. Tamm"));

        // Another write to the same calendar writes the pending change first (§2.11).
        await StoreTesting.Put(store, "home", StoreTesting.Timed("new", "Haircut", "2026-10-22T10:00", "2026-10-22T11:00"));
        Assert.Equal(PendingState.Written, change.State);
        Assert.Null(fake.FindGroup("home", "dentist"));
        Assert.NotNull(fake.FindGroup("home", "new"));

        Assert.True(await pending.UndoWrittenAsync(change));
        var restored = fake.FindGroup("home", "dentist")!;
        Assert.Equal(before.Master!.Raw, restored.Master!.Raw);          // the previous version, byte for byte
    }

    [Fact]
    public async Task AWrittenChangeThatChangedSinceCannotBeUndone()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var change = pending.HoldMove(Occurrence(store, "Dentist, Dr. Tamm"), LocalDateTime.Parse("2026-10-20T15:00"), LocalDateTime.Parse("2026-10-20T15:40"));
        Assert.True(await pending.CommitAsync(change));
        await fake.UpdateGroupAsync("home", "dentist", (_, g) => g! with { Master = g.Master! with { Summary = "Dentist", Raw = null } });
        Assert.False(await pending.UndoWrittenAsync(change));             // calendar.undoUnavailable
        Assert.Equal("Dentist", fake.FindGroup("home", "dentist")!.Master!.Summary);
    }

    [Fact]
    public async Task TheNextActionAndCloseCommit()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var first = pending.HoldDelete(Occurrence(store, "Dentist, Dr. Tamm"));
        await pending.CommitAllAsync();                                     // the next action closes the toast
        Assert.Equal(PendingState.Written, first.State);

        var second = pending.HoldMove(Occurrence(store, "1:1 with Marta"), LocalDateTime.Parse("2026-10-19T12:00"), LocalDateTime.Parse("2026-10-19T12:30"));
        await pending.CloseAsync();                                         // window close waits for the write
        Assert.Equal(PendingState.Written, second.State);
        var moved = fake.Occurrences(Day19, Day20).Single(o => o.Title == "1:1 with Marta");
        Assert.Equal(LocalDateTime.Parse("2026-10-19T12:00"), moved.Start);
        // One occurrence of a weekly series: an override for its original date; the series goes on.
        var group = fake.FindGroup("work", "one-on-one")!;
        var @override = Assert.Single(group.Overrides);
        Assert.Equal(new IcsDateValue.ZonedValue(LocalDateTime.Parse("2026-10-19T11:00"), "Europe/Tallinn"), @override.RecurrenceId);
        Assert.Contains(fake.Occurrences(LocalDateTime.Parse("2026-10-26T00:00"), LocalDateTime.Parse("2026-10-27T00:00")), o => o.Title == "1:1 with Marta" && o.Start == LocalDateTime.Parse("2026-10-26T11:00"));
    }

    [Fact]
    public async Task DeletingOneOccurrenceOfASeriesAddsAnExdate()
    {
        var (fake, store, _) = await Setup();
        using var pending = new PendingChanges(store);
        var change = pending.HoldDelete(Occurrence(store, "Book club: Cotsworth"));
        Assert.True(await pending.CommitAsync(change));
        var master = fake.FindGroup("home", "book-club")!.Master!;
        Assert.Equal(new IcsDateValue.ZonedValue(LocalDateTime.Parse("2026-10-19T19:00"), "Europe/Tallinn"), Assert.Single(master.Exdates));
        Assert.DoesNotContain(fake.Occurrences(Day19, Day20), o => o.Title == "Book club: Cotsworth");
        Assert.Contains(fake.Occurrences(LocalDateTime.Parse("2026-11-16T00:00"), LocalDateTime.Parse("2026-11-17T00:00")), o => o.Title == "Book club: Cotsworth");
    }

    [Fact]
    public async Task AnAlertAMinuteAwayCommits()
    {
        var (fake, store, time) = await Setup();
        using var pending = new PendingChanges(store, time);
        // Book club, 19:00 Tallinn (16:00Z) with an alert an hour before: 15:00Z.
        var bookClub = Occurrence(store, "Book club: Cotsworth");
        var change = pending.HoldMove(bookClub, LocalDateTime.Parse("2026-10-19T20:00"), LocalDateTime.Parse("2026-10-19T22:00"));
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 15, 0, 0, TimeSpan.Zero), change.AlertAt);
        time.Set(new DateTimeOffset(2026, 10, 19, 14, 58, 0, TimeSpan.Zero));
        await pending.CommitDueAsync();
        Assert.Equal(PendingState.Pending, change.State);
        time.Set(new DateTimeOffset(2026, 10, 19, 14, 59, 0, TimeSpan.Zero));
        await pending.CommitDueAsync();
        Assert.Equal(PendingState.Written, change.State);

        // Held when the alert is less than a minute away: the timer writes it at once.
        var designReview = fake.Occurrences(LocalDateTime.Parse("2026-10-21T00:00"), LocalDateTime.Parse("2026-10-22T00:00")).Single(o => o.Title == "Design review");
        time.Set(new DateTimeOffset(2026, 10, 21, 10, 44, 30, TimeSpan.Zero));     // its alert: 13:45 Tallinn, 10:45Z
        var late = pending.HoldDelete(designReview);
        Assert.Equal(new DateTimeOffset(2026, 10, 21, 10, 45, 0, TimeSpan.Zero), late.AlertAt);
        await StoreTesting.Eventually(() => late.State == PendingState.Written, "the alert timer writes the change");
        Assert.Null(fake.FindGroup("work", "design-review"));
    }

    [Fact]
    public async Task TheEarlyCommitReadsAbsoluteAlertsInAnyFormAndTheMovedEnd()
    {
        // Review finding #35 (regression test added in task W11): the commit-before-alert time read only UTC absolute
        // triggers, so an alert written by another app as a floating or zoned time did not commit the change early.
        var (fake, store, time) = await Setup();
        using var pending = new PendingChanges(store, time);
        async Task<IcsExpandedEvent> DentistWith(IcsTrigger trigger)
        {
            await fake.UpdateGroupAsync("home", "dentist", (_, group) =>
                group! with { Master = group.Master! with { Alarms = [new IcsAlarm("DISPLAY", trigger, [])] } });
            return Occurrence(store, "Dentist, Dr. Tamm");                        // 15:40 to 16:20 Tallinn, 12:40Z
        }

        // A floating absolute trigger is a wall clock of the device (Europe/Tallinn, +03:00): 14:10 is 11:10Z.
        var floating = pending.HoldDelete(await DentistWith(new IcsTrigger.Absolute(IcsDateValue.Floating(LocalDateTime.Parse("2026-10-19T14:10")))));
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 11, 10, 0, TimeSpan.Zero), floating.AlertAt);
        Assert.True(pending.Discard(floating));

        // A zoned one is read in its zone: 14:20 in New York (-04:00) is 18:20Z.
        var zoned = pending.HoldDelete(await DentistWith(new IcsTrigger.Absolute(IcsDateValue.Zoned(LocalDateTime.Parse("2026-10-19T14:20"), "America/New_York"))));
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 18, 20, 0, TimeSpan.Zero), zoned.AlertAt);
        Assert.True(pending.Discard(zoned));

        // Relative to the end: the moved occurrence alerts 10 minutes before its new end (10:00 to 10:30, so 10:20 Tallinn,
        // 07:20Z), not before the old length's end (10:40).
        var endAlert = await DentistWith(new IcsTrigger.Relative(-10, IcsTriggerRelation.End));
        var moved = pending.HoldMove(endAlert, LocalDateTime.Parse("2026-10-19T10:00"), LocalDateTime.Parse("2026-10-19T10:30"));
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 7, 20, 0, TimeSpan.Zero), moved.AlertAt);
    }
}
