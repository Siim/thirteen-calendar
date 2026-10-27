using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Events.StoreTesting;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The Calendars pane's view models (§2.15, §2.16; boards D2, L1, L2) over <see cref="FakeEventStore"/> and a file store
/// in a temp folder: groups, collapse with counts, "Hide all" / "Show all", visibility and color, store notices, and
/// the subscription status lines (updated, updating, failed, held back, stale, offline).
/// </summary>
public class CalendarsPaneTests
{
    private static async Task<(FakeEventStore Store, CalendarsPaneViewModel Pane)> Fake()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        return (store, new CalendarsPaneViewModel(store, null, store.Clock, post: a => a()));
    }

    [Fact]
    public async Task TheGroupsListLocalCalendarsThenSubscriptions()
    {
        var (store, pane) = await Fake();
        Assert.Equal("Calendars", pane.Title);
        Assert.Equal(["On this computer", "Subscriptions"], pane.Groups.Select(g => g.Title));
        Assert.Equal(["Home", "Family", "Work", "Running club"], pane.Local.Rows.Select(r => r.Name));
        Assert.Equal(["Holidays in Estonia", "Birthdays"], pane.Subscribed.Rows.Select(r => r.Name));
        Assert.All(pane.Local.Rows, r => Assert.False(r.HasStatus));
        Assert.All(pane.Subscribed.Rows, r =>
        {
            Assert.Equal("Updated 10 min ago", r.StatusText);
            Assert.Equal(CalendarRowStatus.Plain, r.Status);
            Assert.False(r.CanTryAgain);
        });
        Assert.All(pane.Groups, g => Assert.True(g.IsShown));
        Assert.Equal(["New calendar", "Subscribe to calendar", "Import .ics file", "Export"],
            new[] { pane.NewCalendarText, pane.SubscribeText, pane.ImportText, pane.ExportText });
        Assert.Equal("Your events are saved on this computer.", pane.StorageText);
        Assert.False(pane.HasFolder);             // the mockup data set lives in memory
        Assert.False(pane.IsOffline);
        Assert.False(pane.AnyStale);
        Assert.Equal("Calendar settings, Work", pane.Local.Rows[2].SettingsName);
        Assert.Equal("Color, Blue", pane.Local.Rows[2].ColorName);
        Assert.Equal(store.Calendars.Count, pane.Local.Rows.Count + pane.Subscribed.Rows.Count);
    }

    [Fact]
    public async Task ACollapsedGroupCountsItsCalendarsAndIsStored()
    {
        var (store, pane) = await Fake();
        pane.Local.ToggleCollapsedCommand.Execute(null);
        Assert.True(pane.Local.IsCollapsed);
        Assert.False(pane.Local.IsExpanded);
        Assert.Equal("4 calendars, 4 shown", pane.Local.CollapsedText);
        await Eventually(() => store.CollapsedGroups.Contains(CalendarKinds.Local), "the collapsed group stored");

        pane.Local.Rows[1].IsVisible = false;
        await Eventually(() => pane.Local.CollapsedText == "4 calendars, 3 shown", "the count follows the visibility");
        Assert.Equal("On this computer, 4 calendars, 3 shown", pane.Local.HeaderName);

        pane.Local.ToggleCollapsedCommand.Execute(null);
        await Eventually(() => !store.CollapsedGroups.Contains(CalendarKinds.Local), "expanded again");
        Assert.True(pane.Local.IsExpanded);
        Assert.Equal("On this computer", pane.Local.HeaderName);
    }

    [Fact]
    public async Task HideAllAndShowAllChangeThirteensOwnVisibility()
    {
        var (store, pane) = await Fake();
        Assert.Equal("Hide all", pane.Subscribed.ToggleAllText);
        pane.Subscribed.ToggleAllCommand.Execute(null);
        await Eventually(() => store.Calendars.Where(c => c.IsSubscription).All(c => !c.Visible), "every subscription hidden");
        await Eventually(() => pane.Subscribed.ToggleAllText == "Show all", "the header offers Show all");
        Assert.All(pane.Subscribed.Rows, r => Assert.False(r.IsVisible));
        Assert.All(store.Calendars.Where(c => !c.IsSubscription), c => Assert.True(c.Visible));      // the other group is left alone

        pane.Subscribed.Rows[0].IsVisible = true;
        await Eventually(() => store.Find("holidays")!.Visible && pane.Subscribed.Rows[0].IsVisible, "one shown again");
        Assert.Equal("Show all", pane.Subscribed.ToggleAllText);          // one is still hidden
        pane.Subscribed.ToggleAllCommand.Execute(null);
        await Eventually(() => store.Calendars.Where(c => c.IsSubscription).All(c => c.Visible), "every subscription shown");
        await Eventually(() => pane.Subscribed.ToggleAllText == "Hide all", "the header offers Hide all");
    }

    [Fact]
    public async Task TheSwatchChangesTheColor()
    {
        var (store, pane) = await Fake();
        var work = pane.Local.Rows.Single(r => r.Id == "work");
        Assert.Equal("#2563eb", work.SelectedColor!.Hex);
        work.SelectedColor = work.Colors.Single(c => c.Name == "Pink");
        await Eventually(() => store.Find("work")!.Color == "#db2777", "the new color stored");
        await Eventually(() => work.ColorName == "Color, Pink", "the row follows");
        Assert.Equal("Pink", work.SelectedColor!.Name);
    }

    [Fact]
    public async Task ImportAndExportWaitForTheirFlow()
    {
        var (_, pane) = await Fake();
        Assert.False(pane.ImportCommand.CanExecute(null));
        Assert.False(pane.ExportCommand.CanExecute(null));
        var imports = 0;
        string? exported = "none";
        pane.ImportRequested += () => imports++;
        pane.ExportRequested += id => exported = id;
        Assert.True(pane.ImportCommand.CanExecute(null));
        pane.ImportCommand.Execute(null);
        pane.ExportCommand.Execute(null);
        Assert.Equal(1, imports);
        Assert.Null(exported);           // the Export dialog, not one calendar
        Assert.True(pane.CanExport);

        string? subscribe = "none";
        var settings = new List<string>();
        pane.SubscribeRequested += link => subscribe = link;
        pane.SettingsRequested += settings.Add;
        pane.SubscribeCommand.Execute(null);
        pane.Subscribed.Rows[0].SettingsCommand.Execute(null);
        Assert.Null(subscribe);
        Assert.Equal(["holidays"], settings);
    }

    [Fact]
    public async Task LocalRowsShowTheStoreNotices()
    {
        using var folder = new TempFolder();
        string personal;
        string work;
        {
            using var store = Store(folder);
            await store.LoadAsync();
            personal = store.Calendars.Single().Id;
            work = (await store.CreateCalendarAsync("Work", "#2563eb")).Id;
            foreach (var id in new[] { personal, work })
            {
                await Put(store, id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
                await Put(store, id, Timed("b", "Lunch", "2026-10-16T12:00", "2026-10-16T13:00"));
            }
        }
        File.WriteAllText(folder.File(work + ".ics"), "this is not a calendar");
        File.WriteAllText(folder.File(personal + ".ics"), "broken");
        File.WriteAllText(folder.File(personal + ".ics.bak"), "also broken");

        using var reopened = Store(folder);
        await reopened.LoadAsync();
        using var pane = new CalendarsPaneViewModel(reopened, null, new FixedTimeProvider(Now), post: a => a());
        var rows = pane.Local.Rows.ToDictionary(r => r.Name);

        Assert.Equal("Thirteen couldn't read the latest changes to Work, so it restored the last saved copy.", rows["Work"].StatusText);
        Assert.True(rows["Work"].CanOpenFolder);
        Assert.False(rows["Work"].IsReadOnly);
        Assert.Equal("Thirteen couldn't read Personal. Its file is still in the Calendars folder.", rows["Personal"].StatusText);
        Assert.True(rows["Personal"].CanOpenFolder);
        Assert.True(rows["Personal"].IsReadOnly);
        Assert.Equal("Read only", rows["Personal"].ReadOnlyText);
        Assert.True(pane.HasFolder);
        var opened = 0;
        pane.OpenFolderRequested += () => opened++;
        rows["Work"].OpenFolderCommand.Execute(null);
        Assert.Equal(1, opened);
        Assert.False(pane.Subscribed.IsShown);          // no subscriptions: no group

        File.WriteAllText(folder.File(work + ".ics"), Thirteen.Core.Ics.IcsWriter.Serialize(
            Thirteen.Core.Ics.IcsGroups.NewCalendar(work, "Work", "#2563eb"), reopened.Zones));
        await reopened.CheckOutsideChangeAsync(work);
        Assert.Equal("Work changed outside Thirteen, so Thirteen reloaded it.", pane.Local.Rows.Single(r => r.Name == "Work").StatusText);
    }

    /// <summary>A file store with one subscription whose record is set by the test.</summary>
    private static async Task<(EventStore Store, string Id)> WithSubscription(TempFolder folder, FixedTimeProvider time, SubscriptionRecord record)
    {
        var store = Store(folder, time);
        await store.LoadAsync();
        var feed = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Feed//EN\r\nEND:VCALENDAR\r\n";
        var created = await store.CreateSubscriptionAsync("Holidays in Estonia", "#57534e", record, feed);
        return (store, created.Id);
    }

    [Theory]
    [InlineData("subscribe.error.denied", "Couldn't update. The server refused access. The link may be private or expired.")]
    [InlineData("subscribe.error.notFound", "Couldn't update. Nothing was found at this link.")]
    [InlineData("subscribe.error.unreachable", "Couldn't update. Couldn't reach the server. Check the link and your connection.")]
    [InlineData("subscribe.error.notCalendar", "Couldn't update. This link doesn't lead to a calendar.")]
    [InlineData("subscribe.error.tooLarge", "Couldn't update. This calendar is too large (over 25 MB).")]
    public async Task AFailedUpdateSaysWhyWithTryAgain(string error, string text)
    {
        using var folder = new TempFolder();
        var time = new FixedTimeProvider(Now);
        var (store, id) = await WithSubscription(folder, time, new SubscriptionRecord
        {
            Url = "https://calendars.example.com/h.ics",
            Interval = SubscriptionIntervals.Daily,
            LastSuccessAt = "2026-10-19T06:31:00.000Z",
            LastAttemptAt = "2026-10-19T06:40:00.000Z",
            LastError = error,
        });
        using var _ = store;
        using var pane = new CalendarsPaneViewModel(store, null, time, post: a => a());
        var row = pane.Subscribed.Rows.Single();
        Assert.Equal(id, row.Id);
        Assert.Equal(text, row.StatusText);
        Assert.Equal(CalendarRowStatus.Error, row.Status);
        Assert.True(row.IsError);
        Assert.True(row.CanTryAgain);
        Assert.Equal("Try again", row.TryAgainText);
        Assert.Equal($"Holidays in Estonia, {text}", row.AccessibleName);
    }

    [Theory]
    [InlineData("feed-empty", "The feed returned no events. Showing the last copy.")]
    [InlineData("feed-partial", "Part of the feed couldn't be read. Showing the last copy.")]
    public async Task AHeldBackFeedWarnsWithTryAgain(string error, string text)
    {
        using var folder = new TempFolder();
        var time = new FixedTimeProvider(Now);
        var (store, _) = await WithSubscription(folder, time, new SubscriptionRecord
        {
            Url = "https://calendars.example.com/h.ics",
            LastSuccessAt = "2026-10-19T06:31:00.000Z",
            LastError = error,
        });
        using var __ = store;
        using var pane = new CalendarsPaneViewModel(store, null, time, post: a => a());
        var row = pane.Subscribed.Rows.Single();
        Assert.Equal(text, row.StatusText);
        Assert.Equal(CalendarRowStatus.Warning, row.Status);
        Assert.True(row.CanTryAgain);
    }

    [Fact]
    public async Task AStaleFeedWarnsAndManualFeedsNever()
    {
        using var folder = new TempFolder();
        var time = new FixedTimeProvider(Now);
        var (store, id) = await WithSubscription(folder, time, new SubscriptionRecord
        {
            Url = "https://calendars.example.com/h.ics",
            Interval = SubscriptionIntervals.Daily,
            LastSuccessAt = "2026-10-16T06:41:00.000Z",
        });
        using var _ = store;
        using var pane = new CalendarsPaneViewModel(store, null, time, post: a => a());
        var row = pane.Subscribed.Rows.Single();
        Assert.Equal("Updated 3 days ago", row.StatusText);
        Assert.Equal(CalendarRowStatus.Warning, row.Status);
        Assert.False(row.CanTryAgain);
        Assert.True(pane.AnyStale);
        Assert.Equal("Subscriptions not updated", pane.StaleText);

        // Hidden feeds do not mark the toolbar; manual feeds never warn.
        row.IsVisible = false;
        await Eventually(() => !pane.AnyStale, "a hidden stale feed is not counted");
        await store.UpdateRecordAsync(id, r => r with { Visible = true, Subscription = r.Subscription! with { Interval = SubscriptionIntervals.Manual } });
        Assert.Equal(CalendarRowStatus.Plain, pane.Subscribed.Rows.Single().Status);
        Assert.False(pane.AnyStale);

        // Within twice its interval a daily feed is not stale.
        await store.UpdateRecordAsync(id, r => r with { Subscription = r.Subscription! with { Interval = SubscriptionIntervals.Daily, LastSuccessAt = "2026-10-18T05:41:00.000Z" } });
        Assert.Equal("Updated 1 day ago", pane.Subscribed.Rows.Single().StatusText);
        Assert.Equal(CalendarRowStatus.Plain, pane.Subscribed.Rows.Single().Status);
        await store.UpdateRecordAsync(id, r => r with { Subscription = r.Subscription! with { LastSuccessAt = "2026-10-19T04:41:00.000Z" } });
        Assert.Equal("Updated 2 hours ago", pane.Subscribed.Rows.Single().StatusText);
        await store.UpdateRecordAsync(id, r => r with { Subscription = r.Subscription! with { LastSuccessAt = "2026-10-19T06:40:40.000Z" } });
        Assert.Equal("Updated just now", pane.Subscribed.Rows.Single().StatusText);
    }

    [Fact]
    public async Task OfflineShowsOneBannerAndNoNetworkErrors()
    {
        using var folder = new TempFolder();
        var time = new FixedTimeProvider(Now);
        var (store, _) = await WithSubscription(folder, time, new SubscriptionRecord
        {
            Url = "https://calendars.example.com/h.ics",
            LastSuccessAt = "2026-10-19T06:31:00.000Z",
            LastError = "subscribe.error.unreachable",
        });
        using var __ = store;
        var network = new TestNetwork { IsAvailable = false };
        using var service = new SubscriptionService(store, network, time);
        using var pane = new CalendarsPaneViewModel(store, service, time, post: a => a());
        Assert.True(pane.IsOffline);
        Assert.Equal("You're offline. Subscriptions update when you're back online.", pane.OfflineText);
        var row = pane.Subscribed.Rows.Single();
        Assert.Equal("Updated 10 min ago", row.StatusText);
        Assert.Equal(CalendarRowStatus.Plain, row.Status);

        network.IsAvailable = true;
        Assert.False(pane.IsOffline);
        Assert.Equal(CalendarRowStatus.Error, pane.Subscribed.Rows.Single().Status);
    }

    [Fact]
    public async Task ARefreshShowsUpdatingUntilItEnds()
    {
        using var folder = new TempFolder();
        using var server = new FeedServer();
        var release = new TaskCompletionSource();
        server.Handler = async context =>
        {
            await release.Task;
            await FeedServer.Write(context, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Feed//EN\r\nBEGIN:VEVENT\r\nUID:a@feed\r\nDTSTAMP:20261018T120000Z\r\nDTSTART;VALUE=DATE:20261224\r\nSUMMARY:Christmas Eve\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
        };
        var time = new FixedTimeProvider(Now);
        var (store, id) = await WithSubscription(folder, time, new SubscriptionRecord
        {
            Url = server.Url("h.ics"),
            LastSuccessAt = "2026-10-19T06:31:00.000Z",
        });
        using var _ = store;
        using var service = new SubscriptionService(store, new TestNetwork(), time);
        using var pane = new CalendarsPaneViewModel(store, service, time, post: a => a());

        var refresh = pane.Subscribed.Rows.Single().TryAgainCommand.ExecuteAsync(null);
        await Eventually(() => pane.Subscribed.Rows.Single().IsUpdating, "Updating while the request runs");
        Assert.Equal("Updating", pane.Subscribed.Rows.Single().StatusText);
        release.SetResult();
        await refresh;
        await Eventually(() => !pane.Subscribed.Rows.Single().IsUpdating, "the refresh ended");
        Assert.Equal("Updated just now", pane.Subscribed.Rows.Single().StatusText);
        Assert.Equal(1, store.Find(id)!.EventCount);
    }
}
