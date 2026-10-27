using System.Collections.Specialized;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Thirteen.Desktop.Services;
using static Thirteen.Desktop.Tests.Events.StoreTesting;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// A request as the feed server received it, copied when it arrived: Windows' <see cref="HttpListener"/> (http.sys)
/// disposes a request once its response is closed, so the test reads this copy afterwards.
/// </summary>
internal sealed record FeedRequest(Uri? Url, NameValueCollection Headers);

/// <summary>A feed server on 127.0.0.1 (<see cref="HttpListener"/>), answering with <see cref="Handler"/>.</summary>
internal sealed class FeedServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly List<FeedRequest> _requests = [];

    public FeedServer()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        Port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        Prefix = $"http://127.0.0.1:{Port}/";
        _listener.Prefixes.Add(Prefix);
        _listener.Start();
        _ = Task.Run(LoopAsync);
    }

    public int Port { get; }

    public string Prefix { get; }

    public string Url(string path) => Prefix + path.TrimStart('/');

    /// <summary>Answers a request; the response is closed afterwards.</summary>
    public Func<HttpListenerContext, Task> Handler { get; set; } = context =>
    {
        context.Response.StatusCode = 404;
        return Task.CompletedTask;
    };

    public IReadOnlyList<FeedRequest> Requests
    {
        get
        {
            lock (_requests) return _requests.ToArray();
        }
    }

    public static async Task Write(HttpListenerContext context, string body, string? etag = null, string? lastModified = null, string type = "text/calendar; charset=utf-8")
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        context.Response.StatusCode = 200;
        context.Response.ContentType = type;
        if (etag is not null) context.Response.Headers["ETag"] = etag;
        if (lastModified is not null) context.Response.Headers["Last-Modified"] = lastModified;
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes);
    }

    private async Task LoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync();
            }
            catch (Exception) when (_stop.IsCancellationRequested)
            {
                return;
            }
            catch (HttpListenerException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            lock (_requests) _requests.Add(new FeedRequest(context.Request.Url, new NameValueCollection(context.Request.Headers)));
            _ = Task.Run(async () =>
            {
                try
                {
                    await Handler(context);
                }
                catch (Exception)
                {
                    // The client went away (a timeout test).
                }
                finally
                {
                    try
                    {
                        context.Response.Close();
                    }
                    catch (Exception)
                    {
                        // Already closed.
                    }
                }
            });
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        try
        {
            _listener.Stop();
            _listener.Close();
        }
        catch (ObjectDisposedException)
        {
        }
    }
}

/// <summary>A network that is on or off when the test says so.</summary>
internal sealed class TestNetwork : INetworkStatus
{
    private bool _available = true;

    public bool IsAvailable
    {
        get => _available;
        set
        {
            if (_available == value) return;
            _available = value;
            AvailabilityChanged?.Invoke(value);
        }
    }

    public event Action<bool>? AvailabilityChanged;
}

/// <summary>Answers every request with a redirect from https to http (no https server is needed to test the refusal).</summary>
internal sealed class DowngradeHandler : HttpMessageHandler
{
    public List<Uri> Seen { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Seen.Add(request.RequestUri!);
        var response = new HttpResponseMessage(HttpStatusCode.Found);
        response.Headers.Location = new Uri("http://calendars.example.com/feed.ics");
        if (request.RequestUri!.Scheme == "http")
        {
            response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n") };
        }
        return Task.FromResult(response);
    }
}

/// <summary>
/// <see cref="SubscriptionService"/> against an <see cref="HttpListener"/> feed (§6.4 "Tests"): 200, 304 with ETag, an
/// unchanged body with a new ETag, redirects, the https to http downgrade refused, 401, 404, the 25 MB cap, a slow
/// server, a non-calendar body, offline, an older response after a newer one, a zero-event feed and a partly
/// unreadable feed held back and accepted on repetition, and the kept <c>.bak</c>.
/// </summary>
public class SubscriptionServiceTests
{
    private static string Feed(int events, int unreadable = 0, string stamp = "20261018T120000Z", string name = "Holidays in Estonia")
    {
        var text = new StringBuilder();
        text.Append("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Feed//EN\r\n");
        text.Append($"X-WR-CALNAME:{name}\r\nREFRESH-INTERVAL;VALUE=DURATION:P1D\r\n");
        for (var i = 0; i < events; i++)
        {
            text.Append($"BEGIN:VEVENT\r\nUID:event-{i}@feed\r\nDTSTAMP:{stamp}\r\nDTSTART;VALUE=DATE:2026{(i % 12) + 1:00}{(i % 27) + 1:00}\r\nSUMMARY:Holiday {i}\r\nEND:VEVENT\r\n");
        }
        for (var i = 0; i < unreadable; i++)
        {
            // No DTSTART: the reader cannot read it and keeps it aside.
            text.Append($"BEGIN:VEVENT\r\nUID:broken-{i}@feed\r\nDTSTAMP:{stamp}\r\nSUMMARY:Broken {i}\r\nEND:VEVENT\r\n");
        }
        text.Append("END:VCALENDAR\r\n");
        return text.ToString();
    }

    private sealed class Fixture : IDisposable
    {
        public TempFolder Folder { get; } = new();

        public FeedServer Server { get; } = new();

        public TestNetwork Network { get; } = new();

        public FixedTimeProvider Time { get; } = new(Now);

        public EventStore Store { get; private set; } = null!;

        public SubscriptionService Service { get; private set; } = null!;

        public static async Task<Fixture> Create(TimeSpan? timeout = null, long? maxBytes = null)
        {
            var fixture = new Fixture();
            fixture.Store = StoreTesting.Store(fixture.Folder, fixture.Time);
            await fixture.Store.LoadAsync();
            fixture.Service = new SubscriptionService(fixture.Store, fixture.Network, fixture.Time)
            {
                RequestTimeout = timeout ?? TimeSpan.FromSeconds(30),
                MaxBytes = maxBytes ?? StoreText.MaxDocumentBytes,
            };
            return fixture;
        }

        /// <summary>Subscribes to /feed.ics serving <paramref name="body"/>, then moves the clock past the interval.</summary>
        public async Task<CalendarState> Subscribe(string body, string etag = "\"v1\"")
        {
            Server.Handler = context => FeedServer.Write(context, body, etag, "Sun, 18 Oct 2026 12:00:00 GMT");
            var check = await Service.CheckAsync(Server.Url("feed.ics"));
            Assert.Null(check.Error);
            var state = await Service.SubscribeAsync(check, check.SuggestedName, CalendarPalette.NextFree(Store.Calendars.Select(c => c.Color)), check.SuggestedInterval);
            Time.Advance(TimeSpan.FromDays(2));
            return state;
        }

        public SubscriptionRecord Record(string id) => Store.Find(id)!.Record.Subscription!;

        public void Dispose()
        {
            Service.Dispose();
            Store.Dispose();
            Server.Dispose();
            Folder.Dispose();
        }
    }

    [Fact]
    public async Task CheckReadsTheFeedAndSubscribeStoresItAsFetched()
    {
        using var f = await Fixture.Create();
        var body = Feed(112);
        f.Server.Handler = context => FeedServer.Write(context, body, "\"v1\"");
        var check = await f.Service.CheckAsync(f.Server.Url("feed.ics"));
        Assert.Null(check.Error);
        Assert.Equal(112, check.EventCount);
        Assert.Equal("Holidays in Estonia", check.SuggestedName);
        Assert.Equal(SubscriptionIntervals.Daily, check.SuggestedInterval);
        Assert.True(check.IsUnencrypted);
        var request = Assert.Single(f.Server.Requests);
        Assert.Equal("Thirteen/1.0 (Windows)", request.Headers["User-Agent"]);
        Assert.Equal("text/calendar, */*;q=0.5", request.Headers["Accept"]);
        Assert.Null(request.Headers["If-None-Match"]);

        var state = await f.Service.SubscribeAsync(check, "Holidays in Estonia", "#57534e", check.SuggestedInterval);
        Assert.True(state.IsSubscription);
        Assert.Equal(112, state.EventCount);
        Assert.Equal(body, File.ReadAllText(f.Folder.File(state.Id + ".ics")));
        var record = state.Record.Subscription!;
        Assert.Equal(f.Server.Url("feed.ics"), record.Url);
        Assert.Equal("\"v1\"", record.Etag);
        Assert.Equal(StoreText.ContentHash(body), record.ContentHash);
        Assert.Equal("2026-10-19T06:41:00.000Z", record.LastSuccessAt);
        Assert.StartsWith("sha256:", record.ContentHash, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A304WithTheEtagChangesNothingButTheTimes()
    {
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(20));
        f.Server.Handler = context =>
        {
            context.Response.StatusCode = context.Request.Headers["If-None-Match"] == "\"v1\"" ? 304 : 500;
            return Task.CompletedTask;
        };
        Assert.Equal(RefreshOutcome.Unchanged, await f.Service.RefreshAsync(state.Id));
        var request = f.Server.Requests[^1];
        Assert.Equal("\"v1\"", request.Headers["If-None-Match"]);
        Assert.Equal("Sun, 18 Oct 2026 12:00:00 GMT", request.Headers["If-Modified-Since"]);
        Assert.Equal("2026-10-21T06:41:00.000Z", f.Record(state.Id).LastSuccessAt);
        Assert.Null(f.Record(state.Id).LastError);
        Assert.False(File.Exists(f.Folder.File(state.Id + ".ics.bak")));
    }

    [Fact]
    public async Task AnUnchangedBodyWithANewEtagIsNotStoredAgain()
    {
        using var f = await Fixture.Create();
        var body = Feed(20);
        var state = await f.Subscribe(body);
        f.Server.Handler = context => FeedServer.Write(context, body, "\"v2\"");
        Assert.Equal(RefreshOutcome.Unchanged, await f.Service.RefreshAsync(state.Id));
        Assert.Equal("\"v2\"", f.Record(state.Id).Etag);
        Assert.False(File.Exists(f.Folder.File(state.Id + ".ics.bak")));    // the body was not written again
    }

    [Fact]
    public async Task ANewBodyIsStoredAndThePreviousCopyKeptAsBackup()
    {
        using var f = await Fixture.Create();
        var first = Feed(20);
        var state = await f.Subscribe(first);
        var second = Feed(21);
        f.Server.Handler = context => FeedServer.Write(context, second, "\"v2\"");
        Assert.Equal(RefreshOutcome.Stored, await f.Service.RefreshAsync(state.Id));
        Assert.Equal(second, File.ReadAllText(f.Folder.File(state.Id + ".ics")));
        Assert.Equal(first, File.ReadAllText(f.Folder.File(state.Id + ".ics.bak")));
        Assert.Equal(21, f.Store.Find(state.Id)!.EventCount);
        Assert.Equal(StoreText.ContentHash(second), f.Record(state.Id).ContentHash);
    }

    [Fact]
    public async Task AFeedEventWithoutAUidHasTheSameUidAfterARefreshAndAfterARestart()
    {
        // §2.17: a missing UID is derived from the calendar id, DTSTART and SUMMARY, so the refreshed body is read with the
        // subscription's id, as the next start reads the stored file.
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(2));
        var body = Feed(3).Replace("END:VCALENDAR", "BEGIN:VEVENT\r\nDTSTAMP:20261018T120000Z\r\nDTSTART;VALUE=DATE:20261120\r\nSUMMARY:No UID\r\nEND:VEVENT\r\nEND:VCALENDAR", StringComparison.Ordinal);
        f.Server.Handler = context => FeedServer.Write(context, body, "\"v2\"");
        Assert.Equal(RefreshOutcome.Stored, await f.Service.RefreshAsync(state.Id));
        static string UidIn(EventStore store) =>
            store.Occurrences(StoreTesting.At("2026-01-01T00:00"), StoreTesting.At("2027-01-01T00:00")).Single(o => o.Title == "No UID").Uid;
        var refreshed = UidIn(f.Store);
        // The next start, read only beside the running store (which holds the folder's lock).
        using var restarted = StoreTesting.Store(f.Folder, f.Time, readOnly: true);
        await restarted.LoadAsync();
        Assert.StartsWith("missing-", refreshed, StringComparison.Ordinal);
        Assert.Equal(UidIn(restarted), refreshed);
    }

    [Fact]
    public async Task RedirectsAreFollowedUpToFive()
    {
        using var f = await Fixture.Create();
        var body = Feed(3);
        f.Server.Handler = async context =>
        {
            var path = context.Request.Url!.AbsolutePath;
            if (path.StartsWith("/hop", StringComparison.Ordinal))
            {
                var n = int.Parse(path[4..], System.Globalization.CultureInfo.InvariantCulture);
                context.Response.StatusCode = n % 2 == 0 ? 302 : 301;
                context.Response.RedirectLocation = n == 1 ? "/feed.ics" : $"/hop{n - 1}";
                return;
            }
            await FeedServer.Write(context, body);
        };
        var five = await f.Service.CheckAsync(f.Server.Url("hop5"));
        Assert.Null(five.Error);
        Assert.Equal(f.Server.Url("feed.ics"), five.Url!.AbsoluteUri);
        var six = await f.Service.CheckAsync(f.Server.Url("hop6"));
        Assert.Equal("subscribe.error.unreachable", six.Error);
    }

    [Fact]
    public async Task ARedirectFromHttpsToHttpIsRefused()
    {
        using var folder = new TempFolder();
        using var store = Store(folder);
        await store.LoadAsync();
        var handler = new DowngradeHandler();
        using var service = new SubscriptionService(store, new TestNetwork(), new FixedTimeProvider(Now), handler);
        var check = await service.CheckAsync("https://calendars.example.com/feed.ics");
        Assert.Equal("subscribe.error.unreachable", check.Error);
        Assert.Equal(["https://calendars.example.com/feed.ics"], handler.Seen.Select(u => u.AbsoluteUri));
    }

    [Theory]
    [InlineData(401, "subscribe.error.denied")]
    [InlineData(403, "subscribe.error.denied")]
    [InlineData(404, "subscribe.error.notFound")]
    [InlineData(410, "subscribe.error.notFound")]
    [InlineData(500, "subscribe.error.unreachable")]
    public async Task StatusCodesBecomeTheCataloguesErrors(int status, string error)
    {
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(5));
        f.Server.Handler = context =>
        {
            context.Response.StatusCode = status;
            return Task.CompletedTask;
        };
        Assert.Equal(error, (await f.Service.CheckAsync(f.Server.Url("feed.ics"))).Error);
        Assert.Equal(RefreshOutcome.Failed, await f.Service.RefreshAsync(state.Id));
        Assert.Equal(error, f.Record(state.Id).LastError);
        Assert.Equal(5, f.Store.Find(state.Id)!.EventCount);          // stale data stays
        Assert.NotNull(Support.EventStrings.SubscribeError(error));
    }

    [Fact]
    public async Task BodiesOverTheCapAreRefused()
    {
        using var f = await Fixture.Create();
        f.Server.Handler = async context =>
        {
            // Announces 26 MB: refused from the header, before the body is read. The first bytes go out so the headers
            // do too (Windows' http.sys sends nothing for a response closed short of its length; the client would
            // then wait for its timeout).
            context.Response.StatusCode = 200;
            context.Response.ContentLength64 = 26L * 1024 * 1024;
            await context.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes("BEGIN:VCALENDAR\r\n"));
            await context.Response.OutputStream.FlushAsync();
        };
        Assert.Equal("subscribe.error.tooLarge", (await f.Service.CheckAsync(f.Server.Url("big.ics"))).Error);

        using var small = await Fixture.Create(maxBytes: 64 * 1024);
        small.Server.Handler = async context =>
        {
            // No length: refused while reading, as soon as the cap is passed.
            context.Response.StatusCode = 200;
            context.Response.SendChunked = true;
            var chunk = Encoding.UTF8.GetBytes(Feed(1500));      // about 170 kB
            await context.Response.OutputStream.WriteAsync(chunk);
        };
        Assert.Equal("subscribe.error.tooLarge", (await small.Service.CheckAsync(small.Server.Url("big.ics"))).Error);
    }

    [Fact]
    public async Task ASlowServerTimesOut()
    {
        using var f = await Fixture.Create(timeout: TimeSpan.FromMilliseconds(700));
        f.Server.Handler = async context =>
        {
            await Task.Delay(TimeSpan.FromSeconds(4));
            await FeedServer.Write(context, Feed(1));
        };
        var started = DateTime.UtcNow;
        Assert.Equal("subscribe.error.unreachable", (await f.Service.CheckAsync(f.Server.Url("slow.ics"))).Error);
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(3.5));
    }

    [Fact]
    public async Task ABodyThatIsNotACalendarIsSaidSo()
    {
        using var f = await Fixture.Create();
        f.Server.Handler = context => FeedServer.Write(context, "<html><body>Sign in</body></html>", type: "text/html");
        Assert.Equal("subscribe.error.notCalendar", (await f.Service.CheckAsync(f.Server.Url("page"))).Error);
        Assert.Equal("subscribe.error.invalid", (await f.Service.CheckAsync("ftp://example.com/feed.ics")).Error);
        Assert.Equal("subscribe.error.invalid", (await f.Service.CheckAsync("calendar.google.com/basic.ics")).Error);
    }

    [Fact]
    public async Task AWebcalLinkFallsBackToHttpAndWarns()
    {
        using var f = await Fixture.Create();
        var body = Feed(2);
        f.Server.Handler = context => FeedServer.Write(context, body);
        // The listener speaks no TLS, so https fails and the webcal link is tried over http.
        var check = await f.Service.CheckAsync($"webcal://127.0.0.1:{f.Server.Port}/feed.ics");
        Assert.Null(check.Error);
        Assert.Equal("http", check.Url!.Scheme);
        Assert.True(check.IsUnencrypted);
        Assert.Equal(new SubscriptionLink(new Uri("https://example.com/a.ics"), true), SubscriptionLink.Parse("webcal://example.com/a.ics"));
        Assert.Equal(new SubscriptionLink(new Uri("https://example.com/a.ics"), false), SubscriptionLink.Parse("  webcals://example.com/a.ics "));
        // A typed https link gets no http fallback.
        Assert.Equal("subscribe.error.unreachable", (await f.Service.CheckAsync($"https://127.0.0.1:{f.Server.Port}/feed.ics")).Error);
    }

    [Fact]
    public async Task OfflineRefreshesPauseWithoutErrors()
    {
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(5));
        var requests = f.Server.Requests.Count;
        f.Network.IsAvailable = false;
        Assert.True(f.Service.IsOffline);
        await f.Service.RefreshDueAsync();
        Assert.Equal(RefreshOutcome.Offline, await f.Service.RefreshAsync(state.Id));
        Assert.Equal(requests, f.Server.Requests.Count);
        Assert.Null(f.Record(state.Id).LastError);

        f.Network.IsAvailable = true;
        f.Server.Handler = context => FeedServer.Write(context, Feed(6), "\"v2\"");
        await f.Service.RefreshDueAsync();
        Assert.Equal(6, f.Store.Find(state.Id)!.EventCount);
    }

    [Fact]
    public async Task AnOlderResponseFinishingAfterANewerOneIsNotStored()
    {
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(5));
        using var release = new SemaphoreSlim(0);
        f.Server.Handler = async context =>
        {
            await release.WaitAsync();
            await FeedServer.Write(context, Feed(7), "\"old\"");
        };
        var older = f.Service.RefreshAsync(state.Id);          // started at T
        await Eventually(() => f.Server.Requests.Count == 2, "the older request reaches the server");
        Assert.True(f.Service.IsRefreshing(state.Id));
        Assert.Same(older, f.Service.RefreshAsync(state.Id));   // one refresh per subscription at a time

        // Meanwhile a copy whose fetch started later was stored.
        var newer = Feed(9);
        await f.Store.UpdateSubscriptionAsync(state.Id, record => new SubscriptionUpdate(
            record with { Subscription = record.Subscription! with { LastSuccessAt = StoreTime.Precise(Now.AddDays(2).AddMinutes(1)), ContentHash = StoreText.ContentHash(newer) } },
            newer));
        release.Release();
        Assert.Equal(RefreshOutcome.Superseded, await older);
        Assert.Equal(9, f.Store.Find(state.Id)!.EventCount);
        Assert.Equal(newer, File.ReadAllText(f.Folder.File(state.Id + ".ics")));
        Assert.False(f.Service.IsRefreshing(state.Id));
    }

    [Fact]
    public async Task AFeedThatSuddenlyReturnsNothingIsHeldBackOnceThenAccepted()
    {
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(112));
        f.Server.Handler = context => FeedServer.Write(context, Feed(0), "\"empty\"");

        Assert.Equal(RefreshOutcome.HeldBack, await f.Service.RefreshAsync(state.Id));
        Assert.Equal(112, f.Store.Find(state.Id)!.EventCount);      // showing the last copy
        Assert.Equal("feed-empty", f.Record(state.Id).LastError);
        Assert.Equal(new SuspectOutcome { Kind = "empty", Events = 0, Skipped = 0 }, f.Record(state.Id).Suspect);

        f.Time.Advance(TimeSpan.FromDays(1));
        Assert.Equal(RefreshOutcome.Stored, await f.Service.RefreshAsync(state.Id));
        Assert.Equal(0, f.Store.Find(state.Id)!.EventCount);         // the feed really changed
        Assert.Null(f.Record(state.Id).LastError);
        Assert.Null(f.Record(state.Id).Suspect);
        Assert.Equal(Feed(112), File.ReadAllText(f.Folder.File(state.Id + ".ics.bak")));
    }

    [Fact]
    public async Task APartlyUnreadableFeedWithNewStampsIsHeldBackOnceThenAcceptedOnTheSameOutcome()
    {
        using var f = await Fixture.Create();
        var state = await f.Subscribe(Feed(44));
        var request = 0;
        // 44 readable and 6 unreadable components (12%), with a new DTSTAMP on every request (as Google does).
        f.Server.Handler = context => FeedServer.Write(context, Feed(44, 6, $"20261019T0{Interlocked.Increment(ref request)}0000Z"));

        Assert.Equal(RefreshOutcome.HeldBack, await f.Service.RefreshAsync(state.Id));
        Assert.Equal("feed-partial", f.Record(state.Id).LastError);
        Assert.Equal(new SuspectOutcome { Kind = "partial", Events = 44, Skipped = 6 }, f.Record(state.Id).Suspect);
        Assert.Equal(Feed(44), File.ReadAllText(f.Folder.File(state.Id + ".ics")));

        f.Time.Advance(TimeSpan.FromDays(1));
        Assert.Equal(RefreshOutcome.Stored, await f.Service.RefreshAsync(state.Id));
        Assert.Contains("DTSTAMP:20261019T020000Z", File.ReadAllText(f.Folder.File(state.Id + ".ics")), StringComparison.Ordinal);
        Assert.Equal(Feed(44), File.ReadAllText(f.Folder.File(state.Id + ".ics.bak")));      // .bak kept
        Assert.Null(f.Record(state.Id).Suspect);
    }

    [Fact]
    public void DueAndStaleFollowTheInterval()
    {
        var record = new CalendarRecord
        {
            Id = "s",
            Kind = CalendarKinds.Subscription,
            CreatedAt = "2026-10-01T00:00:00Z",
            Subscription = new SubscriptionRecord { Interval = SubscriptionIntervals.Daily, LastAttemptAt = "2026-10-18T06:41:00.000Z", LastSuccessAt = "2026-10-17T06:41:00.000Z" },
        };
        Assert.True(SubscriptionService.IsDue(record, Now));
        Assert.False(SubscriptionService.IsDue(record, Now.AddHours(-1)));
        Assert.False(SubscriptionService.IsStale(record, Now));                  // two days exactly: not yet
        Assert.True(SubscriptionService.IsStale(record, Now.AddMinutes(1)));
        var manual = record with { Subscription = record.Subscription! with { Interval = SubscriptionIntervals.Manual } };
        Assert.False(SubscriptionService.IsDue(manual, Now.AddYears(1)));
        Assert.False(SubscriptionService.IsStale(manual, Now.AddYears(1)));      // manual feeds never warn

        Assert.Equal(SubscriptionIntervals.Hourly, SubscriptionIntervals.FromFeed("PT1H"));
        Assert.Equal(SubscriptionIntervals.Daily, SubscriptionIntervals.FromFeed("P2D"));
        Assert.Equal(SubscriptionIntervals.Weekly, SubscriptionIntervals.FromFeed("P1W"));
        Assert.Equal(SubscriptionIntervals.SixHours, SubscriptionIntervals.FromFeed("PT12H"));
        Assert.Equal(SubscriptionIntervals.SixHours, SubscriptionIntervals.FromFeed(null));
        Assert.Equal(SubscriptionIntervals.SixHours, SubscriptionIntervals.FromFeed("soon"));
    }
}
