using System.Net;
using System.Text;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Events.StoreTesting;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>Answers every request with one feed (no listener needed), and records the requests.</summary>
internal sealed class StubFeedHandler(string body, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
{
    public List<Uri> Seen { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        lock (Seen) Seen.Add(request.RequestUri!);
        return Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "text/calendar"),
        });
    }
}

/// <summary>
/// The Subscribe dialog's model (§2.17 "Subscribe"): a prefilled link is not fetched before Subscribe; the check shows
/// "{name}: {n} events" with Name, Color (next free) and Update (from the feed); the second Subscribe adds it; errors
/// stay inline under the field; an http feed warns. Also the New calendar and Calendar settings models.
/// </summary>
public class SubscribeDialogTests
{
    internal static string Feed(int events, string? name = "Holidays in Estonia", string? refresh = "P1D")
    {
        var text = new StringBuilder("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Feed//EN\r\n");
        if (name is not null) text.Append($"X-WR-CALNAME:{name}\r\n");
        if (refresh is not null) text.Append($"REFRESH-INTERVAL;VALUE=DURATION:{refresh}\r\n");
        for (var i = 0; i < events; i++)
        {
            text.Append($"BEGIN:VEVENT\r\nUID:event-{i}@feed\r\nDTSTAMP:20261018T120000Z\r\nDTSTART;VALUE=DATE:202612{(i % 28) + 1:00}\r\nSUMMARY:Holiday {i}\r\nEND:VEVENT\r\n");
        }
        return text.Append("END:VCALENDAR\r\n").ToString();
    }

    private sealed class Fixture : IDisposable
    {
        public TempFolder Folder { get; } = new();

        public FeedServer Server { get; } = new();

        public FixedTimeProvider Time { get; } = new(Now);

        public EventStore Store { get; private set; } = null!;

        public SubscriptionService Service { get; private set; } = null!;

        public static async Task<Fixture> Create(string? feed = null)
        {
            var fixture = new Fixture();
            fixture.Store = Store(fixture.Folder, fixture.Time);
            await fixture.Store.LoadAsync();
            fixture.Service = new SubscriptionService(fixture.Store, new TestNetwork(), fixture.Time);
            var body = feed ?? Feed(3);
            fixture.Server.Handler = context => context.Request.Url!.AbsolutePath switch
            {
                "/h.ics" => FeedServer.Write(context, body, etag: "\"v1\""),
                "/page.html" => FeedServer.Write(context, "<!doctype html><title>Not a calendar</title>", type: "text/html"),
                _ => NotFound(context),
            };
            return fixture;
        }

        private static Task NotFound(System.Net.HttpListenerContext context)
        {
            context.Response.StatusCode = 404;
            return Task.CompletedTask;
        }

        public void Dispose()
        {
            Service.Dispose();
            Store.Dispose();
            Server.Dispose();
            Folder.Dispose();
        }
    }

    [Fact]
    public async Task APrefilledLinkIsFetchedOnlyWhenSubscribeIsPressedAndTheSecondSubscribeAddsIt()
    {
        using var f = await Fixture.Create();
        var link = f.Server.Url("h.ics");
        var dialog = new SubscribeDialogViewModel(f.Service, f.Store, link);
        Assert.Equal(link, dialog.Link);
        Assert.Equal("Subscribe to a calendar", dialog.Title);
        Assert.Equal("Subscribe to a calendar", dialog.WindowTitle);
        Assert.Equal("Calendar link", dialog.LinkLabel);
        Assert.Equal("webcal:// or https:// link", dialog.Placeholder);
        Assert.StartsWith("Use a public or secret iCal link.", dialog.Help);
        Assert.True(dialog.IsEntering);
        Assert.False(dialog.IsFound);
        Assert.Empty(f.Server.Requests);              // nothing is fetched before Subscribe (§2.17 step 6)

        var checking = false;
        dialog.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SubscribeDialogViewModel.IsChecking) && dialog.IsChecking) checking = true;
        };
        await dialog.SubscribeCommand.ExecuteAsync(null);
        Assert.True(checking);                        // "Checking the link" while it runs
        Assert.Equal("Checking the link", dialog.CheckingText);
        Assert.False(dialog.IsChecking);
        Assert.Single(f.Server.Requests);
        Assert.True(dialog.IsFound);
        Assert.False(dialog.IsEntering);
        Assert.Equal("Holidays in Estonia: 3 events", dialog.Title);
        Assert.Equal("Holidays in Estonia", dialog.Name);
        Assert.Equal("Every day", dialog.SelectedInterval.Label);              // the feed's REFRESH-INTERVAL
        var personal = f.Store.Calendars.Single();
        Assert.NotEqual(personal.Color, dialog.SelectedColor.Hex);             // the next free palette color
        Assert.Equal(CalendarPalette.NextFree([personal.Color]), dialog.SelectedColor.Hex);
        Assert.True(dialog.ShowHttpWarning);                                   // the test server is http
        Assert.Equal("This link isn't encrypted. Others on your network could see this calendar.", dialog.HttpWarning);
        Assert.Equal(["Every hour", "Every 6 hours", "Every day", "Every week", "Manually"], dialog.Intervals.Select(i => i.Label));
        Assert.Equal(11, dialog.Colors.Count);

        CalendarState? added = null;
        var finished = 0;
        dialog.Finished += state =>
        {
            added = state;
            finished++;
        };
        dialog.Name = "Holidays";
        dialog.SelectedInterval = dialog.Intervals[0];
        dialog.SelectedColor = dialog.Colors.Single(c => c.Name == "Teal");
        await dialog.SubscribeCommand.ExecuteAsync(null);
        Assert.Equal(1, finished);
        Assert.NotNull(added);
        var stored = f.Store.Find(added!.Id)!;
        Assert.True(stored.IsSubscription);
        Assert.Equal("Holidays", stored.Name);
        Assert.Equal("#0d9488", stored.Color);
        Assert.Equal(SubscriptionIntervals.Hourly, stored.Record.Subscription!.Interval);
        Assert.Equal(link, stored.Record.Subscription.Url);
        Assert.Equal("\"v1\"", stored.Record.Subscription.Etag);
        Assert.Equal(3, stored.EventCount);
        Assert.Single(f.Server.Requests);             // subscribing stores the checked copy, no second fetch
    }

    [Theory]
    [InlineData("", "Enter a link that starts with webcal://, https:// or http://.")]
    [InlineData("ftp://calendars.example.com/h.ics", "Enter a link that starts with webcal://, https:// or http://.")]
    [InlineData("/missing.ics", "Nothing was found at this link.")]
    [InlineData("/page.html", "This link doesn't lead to a calendar.")]
    public async Task ErrorsStayInlineUnderTheField(string link, string error)
    {
        using var f = await Fixture.Create();
        var text = link.StartsWith('/') ? f.Server.Url(link) : link;
        var dialog = new SubscribeDialogViewModel(f.Service, f.Store, text);
        await dialog.SubscribeCommand.ExecuteAsync(null);
        Assert.Equal(error, dialog.Error);
        Assert.True(dialog.HasError);
        Assert.False(dialog.ShowFoundError);
        Assert.True(dialog.IsEntering);
        Assert.Equal("Subscribe to a calendar", dialog.Title);
        Assert.Single(f.Store.Calendars);             // nothing was added

        dialog.Link = f.Server.Url("h.ics");          // typing clears the error
        Assert.Null(dialog.Error);
        await dialog.SubscribeCommand.ExecuteAsync(null);
        Assert.True(dialog.IsFound);
    }

    [Fact]
    public async Task WithoutACalendarNameTheHostNameIsSuggestedAndSixHoursIsTheDefault()
    {
        using var f = await Fixture.Create(Feed(1, name: null, refresh: null));
        var dialog = new SubscribeDialogViewModel(f.Service, f.Store, f.Server.Url("h.ics"));
        await dialog.SubscribeCommand.ExecuteAsync(null);
        Assert.Equal("127.0.0.1", dialog.Name);
        Assert.Equal("127.0.0.1: 1 event", dialog.Title);
        Assert.Equal("Every 6 hours", dialog.SelectedInterval.Label);
    }

    [Fact]
    public async Task CancelAddsNothing()
    {
        using var f = await Fixture.Create();
        var dialog = new SubscribeDialogViewModel(f.Service, f.Store, f.Server.Url("h.ics"));
        await dialog.SubscribeCommand.ExecuteAsync(null);
        var results = new List<CalendarState?>();
        dialog.Finished += results.Add;
        dialog.CancelCommand.Execute(null);
        Assert.Equal([null], results);
        Assert.Single(f.Store.Calendars);
        Assert.Equal("Cancel", dialog.CancelText);
    }

    [Fact]
    public async Task AWebcalLinkFromTheCommandLineIsPrefilledAsGiven()
    {
        var request = ExternalRequest.Parse(["thirteen://subscribe?url=webcal%3A%2F%2Fcalendars.example.com%2Fh.ics"])!;
        Assert.Equal(ExternalKind.Subscribe, request.Kind);
        var store = new FakeEventStore();
        await store.LoadAsync();
        var handler = new StubFeedHandler(Feed(2));
        using var service = new SubscriptionService(store, new TestNetwork(), store.Clock, handler);
        var dialog = new SubscribeDialogViewModel(service, store, request.Link);
        Assert.Equal("webcal://calendars.example.com/h.ics", dialog.Link);
        Assert.Empty(handler.Seen);
        await dialog.SubscribeCommand.ExecuteAsync(null);
        Assert.Equal([new Uri("https://calendars.example.com/h.ics")], handler.Seen);     // webcal becomes https
        Assert.False(dialog.ShowHttpWarning);
        Assert.Equal("Holidays in Estonia: 2 events", dialog.Title);
    }

    [Fact]
    public async Task NewCalendarNeedsANameAndTakesTheNextFreeColor()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        var dialog = new NewCalendarViewModel(store);
        Assert.Equal("New calendar", dialog.Title);
        Assert.Equal("Save", dialog.SaveText);
        Assert.False(dialog.SaveCommand.CanExecute(null));
        Assert.Equal(CalendarPalette.NextFree(store.Calendars.Select(c => c.Color)), dialog.SelectedColor.Hex);
        dialog.Name = "   ";
        Assert.False(dialog.SaveCommand.CanExecute(null));
        dialog.Name = " Book club ";
        Assert.True(dialog.SaveCommand.CanExecute(null));
        CalendarState? created = null;
        dialog.Finished += state => created = state;
        await dialog.SaveCommand.ExecuteAsync(null);
        Assert.NotNull(created);
        Assert.Equal("Book club", store.Find(created!.Id)!.Name);
        Assert.False(store.Find(created.Id)!.IsSubscription);
    }

    [Fact]
    public async Task CalendarSettingsApplyAndAskBeforeUnsubscribingOrDeleting()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        var asked = new List<(string Message, string Action)>();
        var answer = false;

        var holidays = new CalendarSettingsViewModel(store, null, "holidays")
        {
            Confirm = (message, action) =>
            {
                asked.Add((message, action));
                return Task.FromResult(answer);
            },
        };
        Assert.Equal("Calendar settings", holidays.Title);
        Assert.True(holidays.IsSubscription);
        Assert.False(holidays.IsLocal);
        Assert.Equal("https://calendars.example.com/holidays.ics", holidays.Link);
        Assert.Equal("Every day", holidays.SelectedInterval.Label);
        Assert.False(holidays.UpdateNowCommand.CanExecute(null));          // no subscription service in this test
        holidays.SelectedInterval = holidays.Intervals[3];
        await Eventually(() => store.Find("holidays")!.Record.Subscription!.Interval == SubscriptionIntervals.Weekly, "the interval stored");
        holidays.SelectedColor = holidays.Colors.Single(c => c.Name == "Red");
        await Eventually(() => store.Find("holidays")!.Color == "#dc2626", "the color stored");

        await holidays.UnsubscribeCommand.ExecuteAsync(null);
        Assert.Equal(("Unsubscribe from Holidays in Estonia? Its events disappear from Thirteen.", "Unsubscribe"), asked.Single());
        Assert.NotNull(store.Find("holidays"));       // "Cancel"
        answer = true;
        var closed = 0;
        holidays.Finished += () => closed++;
        await holidays.UnsubscribeCommand.ExecuteAsync(null);
        Assert.Null(store.Find("holidays"));
        Assert.Equal(1, closed);

        asked.Clear();
        var exported = new List<string>();
        var work = new CalendarSettingsViewModel(store, null, "work", exported.Add)
        {
            Confirm = (message, action) =>
            {
                asked.Add((message, action));
                return Task.FromResult(true);
            },
        };
        Assert.True(work.IsLocal);
        work.ExportCommand.Execute(null);
        Assert.Equal(["work"], exported);
        work.Name = "  Office  ";
        await work.CloseCommand.ExecuteAsync(null);
        Assert.Equal("Office", store.Find("work")!.Name);
        var events = store.Find("work")!.EventCount;
        await work.DeleteCommand.ExecuteAsync(null);
        Assert.Equal(($"Delete Office and its {events} events? This can't be undone.", "Delete calendar"), asked.Single());
        Assert.Null(store.Find("work"));

        var family = new CalendarSettingsViewModel(store, null, "family");
        Assert.False(family.ExportCommand.CanExecute(null));             // Export comes with the Export flow (task W8)
    }
}
