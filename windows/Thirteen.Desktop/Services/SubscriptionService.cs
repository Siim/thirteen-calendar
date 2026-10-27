using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.NetworkInformation;
using System.Text;
using Thirteen.Core;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>Whether the computer is online (§2.16 "Offline").</summary>
public interface INetworkStatus
{
    /// <summary>A network connection is available.</summary>
    bool IsAvailable { get; }

    /// <summary>Raised (on any thread) when <see cref="IsAvailable"/> changes.</summary>
    event Action<bool>? AvailabilityChanged;
}

/// <summary><see cref="NetworkInterface.GetIsNetworkAvailable"/> and <see cref="NetworkChange.NetworkAvailabilityChanged"/>.</summary>
public sealed class SystemNetworkStatus : INetworkStatus, IDisposable
{
    /// <summary>Starts listening for changes.</summary>
    public SystemNetworkStatus() => NetworkChange.NetworkAvailabilityChanged += OnChanged;

    /// <inheritdoc />
    public bool IsAvailable
    {
        get
        {
            try
            {
                return NetworkInterface.GetIsNetworkAvailable();
            }
            catch (NetworkInformationException)
            {
                return true;
            }
        }
    }

    /// <inheritdoc />
    public event Action<bool>? AvailabilityChanged;

    private void OnChanged(object? sender, NetworkAvailabilityEventArgs e) => AvailabilityChanged?.Invoke(e.IsAvailable);

    /// <inheritdoc />
    public void Dispose() => NetworkChange.NetworkAvailabilityChanged -= OnChanged;
}

/// <summary>A normalized subscription link (§2.17 step 2).</summary>
/// <param name="Url">The link to fetch: <c>webcal://</c> and <c>webcals://</c> become <c>https://</c>.</param>
/// <param name="TypedWebcal">The user typed <c>webcal://</c>: Windows retries <c>http://</c> when <c>https://</c> cannot be reached.</param>
public sealed record SubscriptionLink(Uri Url, bool TypedWebcal)
{
    /// <summary>Reads what the user typed or a <c>webcal://</c> / <c>thirteen://subscribe?url=</c> argument; null when it is not a link Thirteen can subscribe to (<c>subscribe.error.invalid</c>).</summary>
    public static SubscriptionLink? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var trimmed = text.Trim();
        var colon = trimmed.IndexOf("://", StringComparison.Ordinal);
        if (colon <= 0) return null;
        var scheme = trimmed[..colon].ToLowerInvariant();
        var rest = trimmed[(colon + 3)..];
        var (target, webcal) = scheme switch
        {
            "webcal" or "webcals" => ("https", scheme == "webcal"),
            "https" => ("https", false),
            "http" => ("http", false),
            _ => (null, false),
        };
        if (target is null || rest.Length == 0) return null;
        if (!Uri.TryCreate($"{target}://{rest}", UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host)) return null;
        return new SubscriptionLink(uri, webcal);
    }
}

/// <summary>What the Subscribe dialog shows after "Subscribe" fetched the link (§2.17 step 3).</summary>
public sealed record FeedCheck
{
    /// <summary>A <c>subscribe.error.*</c> id, or null on success.</summary>
    public string? Error { get; init; }

    /// <summary>The link the body came from (https, or http after the webcal fallback).</summary>
    public Uri? Url { get; init; }

    /// <summary>The body as fetched.</summary>
    public string? Body { get; init; }

    /// <summary>The parsed body.</summary>
    public IcsCalendar? Calendar { get; init; }

    /// <summary>The number of events (UID groups).</summary>
    public int EventCount { get; init; }

    /// <summary>The default name: <c>X-WR-CALNAME</c>, else the host name.</summary>
    public string SuggestedName { get; init; } = "";

    /// <summary>The default interval from <c>REFRESH-INTERVAL</c> or <c>X-PUBLISHED-TTL</c>, else every 6 hours.</summary>
    public string SuggestedInterval { get; init; } = SubscriptionIntervals.SixHours;

    /// <summary>The link is not encrypted (<c>subscribe.warning.http</c>).</summary>
    public bool IsUnencrypted => Url?.Scheme == Uri.UriSchemeHttp;

    /// <summary>The response's <c>ETag</c>.</summary>
    public string? Etag { get; init; }

    /// <summary>The response's <c>Last-Modified</c>.</summary>
    public string? LastModified { get; init; }

    /// <summary>When the fetch started.</summary>
    public DateTimeOffset StartedAt { get; init; }
}

/// <summary>How a refresh ended.</summary>
public enum RefreshOutcome
{
    /// <summary>A new copy was stored.</summary>
    Stored,

    /// <summary>The server said 304, or the body's hash is the stored one.</summary>
    Unchanged,

    /// <summary>The body looked like a server glitch and was held back (<c>feed-empty</c>, <c>feed-partial</c>).</summary>
    HeldBack,

    /// <summary>A newer copy was stored while this fetch ran, so this older one was not.</summary>
    Superseded,

    /// <summary>The fetch failed; <see cref="SubscriptionRecord.LastError"/> says why.</summary>
    Failed,

    /// <summary>Offline: nothing was fetched and no error recorded.</summary>
    Offline,

    /// <summary>Not a subscription (any more).</summary>
    Skipped,
}

/// <summary>
/// Subscriptions on Windows (docs/EVENTS.md §2.16, §2.17, §3.6, §6.4): one <see cref="HttpClient"/> over
/// <see cref="SocketsHttpHandler"/> (automatic decompression, PooledConnectionLifetime 10 minutes), redirects followed
/// here (at most 5, an https to http downgrade refused), 30 s timeout, 25 MB cap, <c>User-Agent: Thirteen/1.0
/// (Windows)</c>, <c>Accept: text/calendar, */*;q=0.5</c>, <c>If-None-Match</c> / <c>If-Modified-Since</c> from the
/// stored <c>ETag</c> / <c>Last-Modified</c>, and the content hash to skip unchanged bodies. One refresh per
/// subscription at a time. A body is stored only when its fetch started after the stored copy's, its hash is new,
/// and it is not suspicious (zero events where the stored copy has more than 10, or more than 10% of its
/// components skipped), or suspicious with the same parse outcome as the one held back before. The previous copy is
/// kept as <c>{id}.ics.bak</c> by the store. While running and online, due feeds are refreshed every minute
/// (the first check 10 s after start); offline, refreshes pause and errors are not recorded, and they resume 5 s
/// after the connection returns.
/// </summary>
public sealed class SubscriptionService : IDisposable
{
    /// <summary>The <c>User-Agent</c> of every request.</summary>
    public const string UserAgent = "Thirteen/1.0 (Windows)";

    /// <summary>The <c>Accept</c> of every request.</summary>
    public const string AcceptHeader = "text/calendar, */*;q=0.5";

    private const int MaxRedirects = 5;
    private readonly IEventStore _store;
    private readonly INetworkStatus _network;
    private readonly TimeProvider _time;
    private readonly HttpClient _http;
    private readonly bool _ownsNetwork;
    private readonly object _gate = new();
    private readonly Dictionary<string, Task<RefreshOutcome>> _running = new(StringComparer.Ordinal);
    private ITimer? _dueTimer;
    private ITimer? _resumeTimer;
    private bool _disposed;

    /// <summary>
    /// A service over <paramref name="store"/>. <paramref name="handler"/> replaces the network (tests); without it the
    /// service makes its own <see cref="SocketsHttpHandler"/>.
    /// </summary>
    public SubscriptionService(IEventStore store, INetworkStatus? network = null, TimeProvider? time = null, HttpMessageHandler? handler = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _ownsNetwork = network is null;
        _network = network ?? new SystemNetworkStatus();
        _time = time ?? TimeProvider.System;
        _http = new HttpClient(handler ?? CreateHandler(), disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
        _network.AvailabilityChanged += OnAvailabilityChanged;
    }

    /// <summary>The handler of §6.4.</summary>
    public static SocketsHttpHandler CreateHandler() => new()
    {
        AutomaticDecompression = DecompressionMethods.All,
        AllowAutoRedirect = false,          // followed here, so a downgrade to http is refused and counted
        PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        ConnectTimeout = TimeSpan.FromSeconds(15),
    };

    /// <summary>The time limit of one fetch (30 s; tests shorten it).</summary>
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(30);

    /// <summary>The largest body accepted (25 MB, §3.6).</summary>
    public long MaxBytes { get; init; } = StoreText.MaxDocumentBytes;

    /// <summary>Offline: refreshes pause and the Calendars list shows <c>calendars.offline</c>.</summary>
    public bool IsOffline => !_network.IsAvailable;

    /// <summary>Raised when a subscription starts or stops updating, or the network goes on or off (any thread). The argument is the calendar id, or null for the network.</summary>
    public event Action<string?>? StateChanged;

    /// <summary>True while a subscription is being refreshed ("Updating").</summary>
    public bool IsRefreshing(string calendarId)
    {
        lock (_gate) return _running.ContainsKey(calendarId);
    }

    // ---- The Subscribe dialog ------------------------------------------------------------------------

    /// <summary>
    /// "Subscribe" (§2.17 step 2): fetches the link and reads it. <c>webcal://</c> becomes <c>https://</c>, and when that
    /// cannot be reached and the user typed <c>webcal://</c>, <c>http://</c> is tried.
    /// </summary>
    public async Task<FeedCheck> CheckAsync(string text, CancellationToken cancellationToken = default)
    {
        var started = _time.GetUtcNow();
        if (SubscriptionLink.Parse(text) is not { } link) return new FeedCheck { Error = "subscribe.error.invalid", StartedAt = started };
        var fetch = await FetchAsync(link.Url, null, null, cancellationToken).ConfigureAwait(false);
        if (fetch.Error == "subscribe.error.unreachable" && link.TypedWebcal && link.Url.Scheme == Uri.UriSchemeHttps)
        {
            var http = new UriBuilder(link.Url) { Scheme = Uri.UriSchemeHttp, Port = link.Url.IsDefaultPort ? -1 : link.Url.Port }.Uri;
            var retry = await FetchAsync(http, null, null, cancellationToken).ConfigureAwait(false);
            if (retry.Error is null) fetch = retry;
        }
        if (fetch.Error is { } error) return new FeedCheck { Error = error, StartedAt = started };
        var calendar = await Task.Run(() => TryParse(fetch.Body!), cancellationToken).ConfigureAwait(false);
        if (calendar is null) return new FeedCheck { Error = "subscribe.error.notCalendar", StartedAt = started };
        if (StoreText.EventComponents(calendar) > StoreText.MaxEvents) return new FeedCheck { Error = "subscribe.error.tooLarge", StartedAt = started };
        return new FeedCheck
        {
            Url = fetch.Url,
            Body = fetch.Body,
            Calendar = calendar,
            EventCount = calendar.Groups.Count,
            SuggestedName = string.IsNullOrWhiteSpace(calendar.Name) ? fetch.Url!.Host : calendar.Name!.Trim(),
            SuggestedInterval = SubscriptionIntervals.FromFeed(calendar.RefreshInterval),
            Etag = fetch.Etag,
            LastModified = fetch.LastModified,
            StartedAt = started,
        };
    }

    /// <summary>The second "Subscribe" (§2.17 step 3): adds the subscription with the checked body as its first copy.</summary>
    public async Task<CalendarState> SubscribeAsync(FeedCheck check, string name, string color, string interval, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(check);
        if (check.Error is not null || check.Body is null || check.Url is null) throw new ArgumentException("Only a successful check can be subscribed to", nameof(check));
        var record = new SubscriptionRecord
        {
            Url = check.Url.AbsoluteUri,
            Interval = SubscriptionIntervals.All.Contains(interval) ? interval : SubscriptionIntervals.SixHours,
            Etag = check.Etag,
            LastModified = check.LastModified,
            ContentHash = StoreText.ContentHash(check.Body),
            LastAttemptAt = StoreTime.Precise(check.StartedAt),
            LastSuccessAt = StoreTime.Precise(check.StartedAt),
        };
        var state = await _store.CreateSubscriptionAsync(string.IsNullOrWhiteSpace(name) ? check.SuggestedName : name.Trim(), color, record, check.Body, cancellationToken: cancellationToken).ConfigureAwait(false);
        StateChanged?.Invoke(state.Id);
        return state;
    }

    // ---- Refreshing ----------------------------------------------------------------------------------

    /// <summary>
    /// Refreshes one subscription ("Update now", "Try again", the schedule). While one refresh of it runs, a second call
    /// gets the running one (one refresh per subscription at a time).
    /// </summary>
    public Task<RefreshOutcome> RefreshAsync(string calendarId, CancellationToken cancellationToken = default)
    {
        Task<RefreshOutcome> task;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_running.TryGetValue(calendarId, out var running)) return running;
            task = RunAsync(calendarId, cancellationToken);
            _running[calendarId] = task;
        }
        StateChanged?.Invoke(calendarId);
        return task;
    }

    private async Task<RefreshOutcome> RunAsync(string calendarId, CancellationToken cancellationToken)
    {
        await Task.Yield();
        try
        {
            return await RefreshCoreAsync(calendarId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            lock (_gate) _running.Remove(calendarId);
            StateChanged?.Invoke(calendarId);
        }
    }

    private async Task<RefreshOutcome> RefreshCoreAsync(string calendarId, CancellationToken cancellationToken)
    {
        if (_store.Find(calendarId) is not { IsSubscription: true, Record.Subscription: { } subscription }) return RefreshOutcome.Skipped;
        if (IsOffline) return RefreshOutcome.Offline;
        var started = _time.GetUtcNow();
        if (!Uri.TryCreate(subscription.Url, UriKind.Absolute, out var url))
        {
            await RecordAsync(calendarId, started, "subscribe.error.invalid").ConfigureAwait(false);
            return RefreshOutcome.Failed;
        }
        var fetch = await FetchAsync(url, subscription.Etag, subscription.LastModified, cancellationToken).ConfigureAwait(false);
        if (fetch.Error is { } error)
        {
            // A network failure while (or because) the computer went offline is not the feed's fault (§2.16).
            if (error == "subscribe.error.unreachable" && IsOffline) return RefreshOutcome.Offline;
            await RecordAsync(calendarId, started, error).ConfigureAwait(false);
            return RefreshOutcome.Failed;
        }
        if (fetch.NotModified)
        {
            await _store.UpdateSubscriptionAsync(calendarId, record => Unchanged(record, started, fetch), cancellationToken).ConfigureAwait(false);
            return RefreshOutcome.Unchanged;
        }
        var body = fetch.Body!;
        var hash = StoreText.ContentHash(body);
        IcsCalendar? parsed = null;
        if (hash != subscription.ContentHash)
        {
            parsed = await Task.Run(() => TryParse(body, calendarId), cancellationToken).ConfigureAwait(false);
            if (parsed is null)
            {
                await RecordAsync(calendarId, started, "subscribe.error.notCalendar").ConfigureAwait(false);
                return RefreshOutcome.Failed;
            }
            if (StoreText.EventComponents(parsed) > StoreText.MaxEvents)
            {
                await RecordAsync(calendarId, started, "subscribe.error.tooLarge").ConfigureAwait(false);
                return RefreshOutcome.Failed;
            }
        }
        var outcome = RefreshOutcome.Unchanged;
        await _store.UpdateSubscriptionAsync(calendarId, record =>
        {
            var current = record.Subscription!;
            var attempt = current with { LastAttemptAt = StoreTime.Precise(started) };
            // Stored only if this fetch started after the stored copy's (a slow, older response never overwrites a newer one).
            if (StoreTime.Parse(current.LastSuccessAt) is { } last && started <= last)
            {
                outcome = RefreshOutcome.Superseded;
                return new SubscriptionUpdate(record with { Subscription = attempt });
            }
            if (hash == current.ContentHash || parsed is null)
            {
                outcome = RefreshOutcome.Unchanged;
                return Unchanged(record, started, fetch);
            }
            var (events, skipped, components) = StoreText.ParseOutcome(parsed);
            var storedEvents = _store.Find(calendarId)?.EventCount ?? 0;
            string? suspicious = events == 0 && storedEvents > 10 ? "empty"
                : components > 0 && skipped * 10 > components ? "partial"
                : null;
            var suspect = suspicious is null ? null : new SuspectOutcome { Kind = suspicious, Events = events, Skipped = skipped };
            if (suspect is not null && suspect != current.Suspect)
            {
                // Held back once; the same outcome next time means the feed really changed (§2.16).
                outcome = RefreshOutcome.HeldBack;
                return new SubscriptionUpdate(record with
                {
                    Subscription = attempt with { Suspect = suspect, LastError = suspicious == "empty" ? "feed-empty" : "feed-partial" },
                });
            }
            outcome = RefreshOutcome.Stored;
            return new SubscriptionUpdate(record with
            {
                Subscription = attempt with
                {
                    Etag = fetch.Etag,
                    LastModified = fetch.LastModified,
                    ContentHash = hash,
                    Suspect = null,
                    LastSuccessAt = StoreTime.Precise(started),
                    LastError = null,
                },
            }, body, parsed);
        }, cancellationToken).ConfigureAwait(false);
        return outcome;
    }

    private static SubscriptionUpdate Unchanged(CalendarRecord record, DateTimeOffset started, FetchResult fetch)
    {
        var current = record.Subscription!;
        var newer = StoreTime.Parse(current.LastSuccessAt) is not { } last || started > last;
        return new SubscriptionUpdate(record with
        {
            Subscription = current with
            {
                Etag = fetch.Etag ?? current.Etag,
                LastModified = fetch.LastModified ?? current.LastModified,
                LastAttemptAt = StoreTime.Precise(started),
                LastSuccessAt = newer ? StoreTime.Precise(started) : current.LastSuccessAt,
                LastError = null,
                Suspect = null,
            },
        });
    }

    private Task RecordAsync(string calendarId, DateTimeOffset started, string error) =>
        _store.UpdateSubscriptionAsync(calendarId, record => new SubscriptionUpdate(record with
        {
            Subscription = record.Subscription! with { LastAttemptAt = StoreTime.Precise(started), LastError = error },
        }));

    /// <summary>
    /// A body as a calendar, or null when it is not one. A refresh parses with the subscription's calendar id, as the
    /// store does at start, so the UIDs derived for events without one (§2.17) and their occurrence keys stay the same
    /// across a refresh and a restart.
    /// </summary>
    private IcsCalendar? TryParse(string body, string calendarId = "")
    {
        try
        {
            return IcsReader.Parse(body, calendarId, _store.Zones);
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    // ---- The schedule ------------------------------------------------------------------------------

    /// <summary>A subscription is due when its interval has passed since its last attempt (manual feeds never are).</summary>
    public static bool IsDue(CalendarRecord record, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(record);
        if (record.Subscription is not { } subscription || SubscriptionIntervals.Length(subscription.Interval) is not { } interval) return false;
        var last = StoreTime.Parse(subscription.LastAttemptAt) ?? StoreTime.Parse(subscription.LastSuccessAt);
        return last is null || now - last.Value >= interval;
    }

    /// <summary>
    /// A feed not updated for twice its interval, whatever the reason (§2.16): its row warns and the Calendar toolbar
    /// shows "Subscriptions not updated". Manual feeds never warn.
    /// </summary>
    public static bool IsStale(CalendarRecord record, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(record);
        if (record.Subscription is not { } subscription || SubscriptionIntervals.Length(subscription.Interval) is not { } interval) return false;
        var last = StoreTime.Parse(subscription.LastSuccessAt) ?? StoreTime.Parse(record.CreatedAt);
        return last is not null && now - last.Value > interval * 2;
    }

    /// <summary>Refreshes every visible subscription that is due, one after another (nothing while offline).</summary>
    public async Task RefreshDueAsync(CancellationToken cancellationToken = default)
    {
        if (IsOffline) return;
        var now = _time.GetUtcNow();
        foreach (var calendar in _store.Calendars.Where(c => c.IsSubscription && c.Visible && IsDue(c.Record, now)).ToList())
        {
            if (IsOffline || _disposed) return;
            try
            {
                await RefreshAsync(calendar.Id, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (e is EventStoreException or IOException or InvalidOperationException)
            {
                Trace.WriteLine($"Thirteen: could not refresh {calendar.Id}: {e.Message}");
            }
        }
    }

    /// <summary>Starts the schedule: the first due check 10 s after start, then every minute.</summary>
    public void Start()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _dueTimer ??= _time.CreateTimer(_ => _ = RefreshDueAsync(), null, TimeSpan.FromSeconds(10), TimeSpan.FromMinutes(1));
        }
    }

    private void OnAvailabilityChanged(bool available)
    {
        StateChanged?.Invoke(null);
        if (!available) return;
        lock (_gate)
        {
            if (_disposed) return;
            _resumeTimer?.Dispose();
            _resumeTimer = _time.CreateTimer(_ => _ = RefreshDueAsync(), null, TimeSpan.FromSeconds(5), Timeout.InfiniteTimeSpan);
        }
    }

    // ---- HTTP --------------------------------------------------------------------------------------

    /// <summary>A fetch's result: a body, "not modified", or a <c>subscribe.error.*</c> id.</summary>
    private sealed record FetchResult(string? Error, Uri? Url = null, string? Body = null, bool NotModified = false, string? Etag = null, string? LastModified = null);

    private async Task<FetchResult> FetchAsync(Uri url, string? etag, string? lastModified, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(RequestTimeout);
        var current = url;
        try
        {
            for (var redirects = 0; ; redirects++)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, current);
                request.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
                request.Headers.TryAddWithoutValidation("Accept", AcceptHeader);
                if (etag is not null) request.Headers.TryAddWithoutValidation("If-None-Match", etag);
                if (lastModified is not null) request.Headers.TryAddWithoutValidation("If-Modified-Since", lastModified);
                using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
                var status = (int)response.StatusCode;
                if (status is 301 or 302 or 303 or 307 or 308)
                {
                    if (redirects >= MaxRedirects || response.Headers.Location is not { } location) return new FetchResult("subscribe.error.unreachable");
                    var next = location.IsAbsoluteUri ? location : new Uri(current, location);
                    if (current.Scheme == Uri.UriSchemeHttps && next.Scheme != Uri.UriSchemeHttps) return new FetchResult("subscribe.error.unreachable");   // no downgrade
                    if (next.Scheme != Uri.UriSchemeHttps && next.Scheme != Uri.UriSchemeHttp) return new FetchResult("subscribe.error.unreachable");
                    current = next;
                    continue;
                }
                if (status == 304 && (etag is not null || lastModified is not null))
                {
                    return new FetchResult(null, current, NotModified: true, Etag: response.Headers.ETag?.ToString(), LastModified: LastModifiedOf(response));
                }
                if (status is 401 or 403) return new FetchResult("subscribe.error.denied");
                if (status is 404 or 410) return new FetchResult("subscribe.error.notFound");
                if (status is < 200 or > 299) return new FetchResult("subscribe.error.unreachable");
                if (response.Content.Headers.ContentLength is { } length && length > MaxBytes) return new FetchResult("subscribe.error.tooLarge");
                var bytes = await ReadCappedAsync(response.Content, timeout.Token).ConfigureAwait(false);
                if (bytes is null) return new FetchResult("subscribe.error.tooLarge");
                var text = Decode(bytes, response.Content.Headers.ContentType);
                return new FetchResult(null, current, text, Etag: response.Headers.ETag?.ToString(), LastModified: LastModifiedOf(response));
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new FetchResult("subscribe.error.unreachable");     // the 30 s limit
        }
        catch (Exception e) when (e is HttpRequestException or IOException or InvalidOperationException or UriFormatException)
        {
            Trace.WriteLine($"Thirteen: could not fetch a subscription: {e.Message}");
            return new FetchResult("subscribe.error.unreachable");
        }
    }

    private static string? LastModifiedOf(HttpResponseMessage response) =>
        response.Content.Headers.TryGetValues("Last-Modified", out var values) ? values.FirstOrDefault() : null;

    /// <summary>The body, or null when it is larger than <see cref="MaxBytes"/>.</summary>
    private async Task<byte[]?> ReadCappedAsync(HttpContent content, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (buffer.Length + read > MaxBytes) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private static string Decode(byte[] bytes, MediaTypeHeaderValue? type)
    {
        if (bytes.Length >= 2 && (bytes[0] == 0xEF || bytes[0] == 0xFF || bytes[0] == 0xFE)) return StoreText.Decode(bytes);
        var charset = type?.CharSet?.Trim('"').ToLowerInvariant();
        if (charset is null or "utf-8" or "utf8") return StoreText.Decode(bytes);
        try
        {
            return Encoding.GetEncoding(charset).GetString(bytes);
        }
        catch (ArgumentException)
        {
            return StoreText.Decode(bytes);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _dueTimer?.Dispose();
            _resumeTimer?.Dispose();
        }
        _network.AvailabilityChanged -= OnAvailabilityChanged;
        if (_ownsNetwork && _network is SystemNetworkStatus system) system.Dispose();
        _http.Dispose();
    }
}
