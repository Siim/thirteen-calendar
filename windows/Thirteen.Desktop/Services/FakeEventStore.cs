using System.Globalization;
using System.Text.Json;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>
/// The mockup data set (docs/EVENTS.md §6.7) as an in-memory store: <c>fixtures/mockup/mockup-events.json</c>, linked
/// into the app as an embedded resource (Thirteen.Desktop.csproj), is read into one iCalendar document per calendar, so
/// every view model, screenshot run (<c>--fake-events</c>) and test sees the same events as the other platforms and
/// the boards, through the same expansion as the real store. Writable calendars become local calendars ("On this
/// computer"), the read-only ones (Holidays in Estonia, Birthdays) subscriptions. Changes stay in memory.
/// </summary>
public sealed class FakeEventStore : EventStoreBase
{
    /// <summary>The logical name of the embedded <c>mockup-events.json</c>.</summary>
    public const string ResourceName = "Thirteen.Desktop.MockupEvents.json";

    private readonly string _json;
    private int _nextId;

    /// <summary>The mockup data set from the embedded resource, or from <paramref name="json"/>.</summary>
    public FakeEventStore(string? json = null, IZoneResolver? zones = null, TimeProvider? time = null)
        : this(json ?? ReadResource(), zones ?? WindowsZoneResolver.Shared, time, 0)
    {
    }

    private FakeEventStore(string json, IZoneResolver zones, TimeProvider? time, int _)
        : this(json, DeviceZoneOf(json), zones, time)
    {
    }

    private FakeEventStore(string json, string deviceZone, IZoneResolver zones, TimeProvider? time)
        : base(zones, () => deviceZone, time ?? new FixedTimeProvider(NowOf(json)))
    {
        _json = json;
    }

    /// <summary>The data set's "now" (2026-10-19T09:41 in Europe/Tallinn) as a UTC instant.</summary>
    public DateTimeOffset Now => Time.GetUtcNow();

    /// <inheritdoc />
    public override string? Folder => null;

    /// <summary>The embedded <c>mockup-events.json</c>.</summary>
    public static string ReadResource()
    {
        using var stream = typeof(FakeEventStore).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The app has no embedded {ResourceName}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static string DeviceZoneOf(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.GetProperty("deviceZone").GetString() ?? "Europe/Tallinn";
    }

    /// <summary>The data set's "now" in UTC (its local time in its device zone).</summary>
    private static DateTimeOffset NowOf(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var local = LocalDateTime.Parse(root.GetProperty("now").GetString()!);
        var zone = root.GetProperty("deviceZone").GetString()!;
        var utc = ZoneMath.ToUtc(local, zone, WindowsZoneResolver.Shared) ?? local;
        return new DateTimeOffset(utc.Date.Year, utc.Date.Month, utc.Date.Day, utc.Minute / 60, utc.Minute % 60, 0, TimeSpan.Zero);
    }

    /// <inheritdoc />
    protected override string NewId() => "new-" + Interlocked.Increment(ref _nextId).ToString(CultureInfo.InvariantCulture);

    /// <inheritdoc />
    protected override LoadedStore LoadStore(CancellationToken cancellationToken)
    {
        using var json = JsonDocument.Parse(_json);
        var root = json.RootElement;
        var now = Time.GetUtcNow();
        var stamp = new IcsDateValue.UtcValue(LocalDateTime.Parse("2026-10-01T09:00"));
        var entries = new List<Entry>();
        var localOrder = 0;
        var subscriptionOrder = 0;
        foreach (var calendar in root.GetProperty("calendars").EnumerateArray())
        {
            var id = calendar.GetProperty("id").GetString()!;
            var writable = calendar.GetProperty("writable").GetBoolean();
            var record = new CalendarRecord
            {
                Id = id,
                Kind = writable ? CalendarKinds.Local : CalendarKinds.Subscription,
                Name = calendar.GetProperty("title").GetString()!,
                Color = calendar.GetProperty("color").GetString()!.ToLowerInvariant(),
                Order = writable ? localOrder++ : subscriptionOrder++,
                Visible = true,
                CreatedAt = "2026-01-01T09:00:00Z",
                Subscription = writable ? null : new SubscriptionRecord
                {
                    Url = $"https://calendars.example.com/{id}.ics",
                    Interval = SubscriptionIntervals.Daily,
                    ContentHash = null,
                    LastAttemptAt = StoreTime.Precise(now.AddMinutes(-10)),
                    LastSuccessAt = StoreTime.Precise(now.AddMinutes(-10)),
                },
            };
            var document = IcsGroups.NewCalendar(id, record.Name, record.Color);
            foreach (var e in root.GetProperty("events").EnumerateArray())
            {
                if (e.GetProperty("calendarId").GetString() != id) continue;
                var component = EventOf(e, stamp);
                document = IcsGroups.ReplaceGroup(document, new IcsGroup(component.Uid, component, ValueList<IcsEvent>.Empty));
            }
            // Stored as text and read back, like a document on disk (every group then has its raw text).
            var text = IcsWriter.Serialize(document, Zones, new LocalDateTime(new GregorianDate(2026, 10, 1), 9 * 60));
            entries.Add(new Entry(record) { Document = IcsReader.Parse(text, id, Zones) });
        }
        return new LoadedStore(entries, [], []);
    }

    /// <summary>One mockup event as a <c>VEVENT</c>.</summary>
    private static IcsEvent EventOf(JsonElement e, IcsDateValue stamp)
    {
        var id = e.GetProperty("id").GetString()!;
        var uid = id[(id.IndexOf('/', StringComparison.Ordinal) + 1)..];
        var allDay = e.GetProperty("allDay").GetBoolean();
        var start = LocalDateTime.Parse(e.GetProperty("start").GetString()!);
        var end = LocalDateTime.Parse(e.GetProperty("end").GetString()!);
        var zone = e.GetProperty("timeZone").ValueKind == JsonValueKind.String ? e.GetProperty("timeZone").GetString() : null;
        IcsDateValue startValue;
        IcsDateValue? endValue;
        if (allDay)
        {
            startValue = new IcsDateValue.DateValue(start.Date);
            var last = end.IsEndOfDay ? end.Date : end.Date.AddDays(-1);
            endValue = IcsGroups.AllDayEnd(start.Date, last).End;
        }
        else if (zone is null)
        {
            startValue = new IcsDateValue.FloatingValue(start);
            endValue = new IcsDateValue.FloatingValue(end);
        }
        else
        {
            startValue = new IcsDateValue.ZonedValue(start, zone);
            endValue = new IcsDateValue.ZonedValue(end, zone);
        }
        var rrules = e.GetProperty("rrule").ValueKind == JsonValueKind.String
            ? new[] { RRule.Parse(e.GetProperty("rrule").GetString()!) }.ToValueList()
            : ValueList<RRule>.Empty;
        var marker = e.GetProperty("marker").ValueKind == JsonValueKind.String ? e.GetProperty("marker").GetString() : null;
        var alarms = new List<IcsAlarm>();
        foreach (var alarm in e.GetProperty("alarms").EnumerateArray())
        {
            if (alarm.GetProperty("kind").GetString() != "relative") continue;
            alarms.Add(new IcsAlarm("DISPLAY", new IcsTrigger.Relative(alarm.GetProperty("offsetMinutes").GetInt32(), IcsTriggerRelation.Start),
                [new IcsProperty("DESCRIPTION", "Reminder")]));
        }
        var extra = new List<IcsProperty>();
        if (e.GetProperty("organizer") is { ValueKind: JsonValueKind.Object } organizer)
        {
            // An invitation: the organizer and the attendees, the user (accepted) among them.
            var name = organizer.GetProperty("name").GetString()!;
            extra.Add(new IcsProperty("ORGANIZER", [new IcsParameter("CN", name)], $"mailto:{Mail(name)}"));
            var count = e.GetProperty("attendeeCount").GetInt32();
            var self = e.GetProperty("selfStatus").ValueKind == JsonValueKind.String ? e.GetProperty("selfStatus").GetString()!.ToUpperInvariant() : "NEEDS-ACTION";
            extra.Add(new IcsProperty("ATTENDEE", [new IcsParameter("CN", "Liis Kask"), new IcsParameter("PARTSTAT", self)], "mailto:liis.kask@example.com"));
            for (var i = 2; i <= count; i++)
            {
                extra.Add(new IcsProperty("ATTENDEE", [new IcsParameter("PARTSTAT", "ACCEPTED")], $"mailto:guest{i}@example.com"));
            }
        }
        return new IcsEvent
        {
            Uid = uid,
            Summary = e.GetProperty("title").GetString() ?? "",
            Location = e.GetProperty("location").GetString() ?? "",
            Description = e.GetProperty("notes").GetString() ?? "",
            Url = e.GetProperty("url").GetString() ?? "",
            Start = startValue,
            End = endValue,
            RRules = rrules,
            ThirteenRule = marker,
            Status = (e.GetProperty("status").GetString() ?? "confirmed").ToUpperInvariant(),
            Transp = e.GetProperty("availability").GetString() == "free" ? "TRANSPARENT" : "OPAQUE",
            Alarms = alarms.ToValueList(),
            Created = stamp,
            LastModified = stamp,
            Dtstamp = stamp,
            Extra = extra.ToValueList(),
        };
    }

    private static string Mail(string name) => name.ToLowerInvariant().Replace(' ', '.') + "@example.com";

    /// <inheritdoc />
    protected override IcsCalendar? CurrentDocument(Entry entry) => entry.Document;

    /// <inheritdoc />
    protected override void StoreDocument(Entry entry, string text)
    {
    }

    /// <inheritdoc />
    protected override void StoreIndex(CalendarIndexDocument index)
    {
    }

    /// <inheritdoc />
    protected override void RemoveDocument(Entry entry)
    {
    }
}

/// <summary>A clock that stands still at one instant (the mockup's "now"), or moves only when told.</summary>
public sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    private DateTimeOffset _now = now;

    /// <inheritdoc />
    public override DateTimeOffset GetUtcNow() => _now;

    /// <summary>Moves the clock.</summary>
    public void Advance(TimeSpan by) => _now += by;

    /// <summary>Sets the clock.</summary>
    public void Set(DateTimeOffset now) => _now = now;
}
