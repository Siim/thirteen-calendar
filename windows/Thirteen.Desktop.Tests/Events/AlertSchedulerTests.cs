using System.Globalization;
using System.Text;
using System.Xml.Linq;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// Alerts on Windows (task W9, docs/EVENTS.md §2.14, §6.4): what fires when (times from core's alarm rules with each
/// occurrence's UTC start, so a weekly event keeps its wall-clock alert across the October DST change), which calendars
/// alert, the 60-day window and the 1,000 cap, the toast XML (protocol activation, escaping), and the scheduler's diff
/// against Windows' schedule through a fake platform.
/// </summary>
public sealed class AlertSchedulerTests
{
    private const string CalendarId = "alerts-0001";

    private static string Alarm(string trigger, string action = "DISPLAY") =>
        $"BEGIN:VALARM\r\nACTION:{action}\r\n{trigger}\r\nDESCRIPTION:Reminder\r\n" + (action == "EMAIL" ? "SUMMARY:Mail\r\nATTENDEE:mailto:a@example.com\r\n" : "") + "END:VALARM\r\n";

    private static string Event(string uid, string summary, string start, string end, string extra = "", params string[] alarms) =>
        $"BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTAMP:20261001T090000Z\r\n{start}\r\n{end}\r\nSUMMARY:{summary}\r\n{extra}" + string.Concat(alarms) + "END:VEVENT\r\n";

    private static string Calendar(string name, params string[] events) =>
        $"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Thirteen tests//EN\r\nX-WR-CALNAME:{name}\r\n" + string.Concat(events) + "END:VCALENDAR\r\n";

    private static string Tallinn(string value) => $";TZID=Europe/Tallinn:{value}";

    /// <summary>The calendar of the plan tests; now is 2026-10-19T06:41Z (09:41 in Tallinn), the window ends 2026-12-18T06:41Z.</summary>
    private static readonly string Alerts = Calendar("Alerts",
        Event("standup", "Standup", "DTSTART" + Tallinn("20261020T090000"), "DTEND" + Tallinn("20261020T091500"), "RRULE:FREQ=WEEKLY;COUNT=3\r\n", Alarm("TRIGGER:-PT15M")),
        Event("birthday", "Mari's birthday", "DTSTART;VALUE=DATE:20261022", "DTEND;VALUE=DATE:20261023", "", Alarm("TRIGGER:-PT15H")),
        Event("flight", "Flight <TLL> & \"HEL\"", "DTSTART" + Tallinn("20261021T100000"), "DTEND" + Tallinn("20261021T120000"), "LOCATION:Gate 3\r\n", Alarm("TRIGGER;RELATED=END:-PT30M", "AUDIO")),
        Event("sauna", "Sauna", "DTSTART" + Tallinn("20261024T180000"), "DTEND" + Tallinn("20261024T200000"), "", Alarm("TRIGGER;VALUE=DATE-TIME:20261023T120000Z"), Alarm("TRIGGER:-PT1H", "EMAIL")),
        Event("canceled", "Lunch", "DTSTART" + Tallinn("20261022T120000"), "DTEND" + Tallinn("20261022T130000"), "STATUS:CANCELLED\r\n", Alarm("TRIGGER:-PT10M")),
        Event("past", "Breakfast", "DTSTART" + Tallinn("20261019T090000"), "DTEND" + Tallinn("20261019T093000"), "", Alarm("TRIGGER:-PT15M")),
        Event("twice", "Dentist", "DTSTART" + Tallinn("20261026T100000"), "DTEND" + Tallinn("20261026T104500"), "", Alarm("TRIGGER:-PT1H"), Alarm("TRIGGER:-PT60M")),
        Event("week", "Concert", "DTSTART" + Tallinn("20261220T120000"), "DTEND" + Tallinn("20261220T140000"), "", Alarm("TRIGGER:-P7D")),
        Event("edge-in", "Early train", "DTSTART" + Tallinn("20261218T080000"), "DTEND" + Tallinn("20261218T090000"), "", Alarm("TRIGGER:-PT15M")),
        Event("edge-out", "Late train", "DTSTART" + Tallinn("20261218T100000"), "DTEND" + Tallinn("20261218T110000"), "", Alarm("TRIGGER:-PT15M")),
        Event("silent", "No alert", "DTSTART" + Tallinn("20261021T150000"), "DTEND" + Tallinn("20261021T160000")));

    private static async Task<EventStore> StoreWith(TempFolder folder, params (string Id, string Text)[] calendars)
    {
        foreach (var (id, text) in calendars) File.WriteAllText(folder.File(id + ".ics"), text, new UTF8Encoding(false));
        var store = StoreTesting.Store(folder);
        await store.LoadAsync();
        return store;
    }

    private static DateTimeOffset Utc(string text) => DateTimeOffset.Parse(text + "Z", CultureInfo.InvariantCulture);

    [Fact]
    public async Task Plan_FiresAtCoreAlarmTimes_FromEachOccurrencesUtcStart()
    {
        using var folder = new TempFolder();
        using var store = await StoreWith(folder, (CalendarId, Alerts));
        var plan = AlertPlanner.Plan(store, StoreTesting.Now, use24Hour: true);
        Assert.Equal(
            [
                ("Standup", Utc("2026-10-20T05:45")),            // 09:00 EEST, 15 minutes before
                ("Mari's birthday", Utc("2026-10-21T06:00")),    // all day: 09:00 the day before
                ("Flight <TLL> & \"HEL\"", Utc("2026-10-21T08:30")), // 30 minutes before the end
                ("Sauna", Utc("2026-10-23T12:00")),              // absolute; the EMAIL alarm is not an alert
                ("Dentist", Utc("2026-10-26T07:00")),            // two alarms at one moment: one toast
                ("Standup", Utc("2026-10-27T06:45")),            // 09:00 EET after the DST change
                ("Standup", Utc("2026-11-03T06:45")),
                ("Concert", Utc("2026-12-13T10:00")),            // 1 week before an occurrence past the window
                ("Early train", Utc("2026-12-18T05:45")),        // inside the 60 days; "Late train" fires after them
            ],
            plan.Select(a => (a.Title, a.FireAt)).ToArray());
        // 15 hex digits: Windows refuses a scheduled toast id of 16 characters or more (0x803E0120, found on the VM in W11).
        Assert.All(plan, a => Assert.Matches("^[0-9a-f]{15}$", a.Id));
        Assert.Equal(plan.Count, plan.Select(a => a.Id).Distinct().Count());
        Assert.Equal(["2026-10-20", "2026-10-22", "2026-10-21"], plan.Take(3).Select(a => a.Day.ToIsoString()).ToArray());
        Assert.Equal(["09:00 to 09:15", "All day", "10:00 to 12:00, Gate 3"], plan.Take(3).Select(a => a.Body).ToArray());

        // The same store planned again gives the same ids (an unchanged alert keeps its toast).
        Assert.Equal(plan.Select(a => a.Id), AlertPlanner.Plan(store, StoreTesting.Now, use24Hour: true).Select(a => a.Id));
        // The 12-hour clock changes the body, and with it the id.
        var twelve = AlertPlanner.Plan(store, StoreTesting.Now, use24Hour: false);
        Assert.Equal("10:00 AM to 12:00 PM, Gate 3", twelve[2].Body);
        Assert.NotEqual(plan[2].Id, twelve[2].Id);
    }

    [Fact]
    public void ToastXml_ActivatesThroughTheProtocol_AndEscapesUserText()
    {
        var xml = AlertPlanner.ToastXml("Flight <TLL> & \"HEL\"", "10:00 to 12:00, Gate 3", new Thirteen.Core.GregorianDate(2026, 10, 21));
        var toast = XDocument.Parse(xml).Root!;
        Assert.Equal("toast", toast.Name.LocalName);
        Assert.Equal("protocol", toast.Attribute("activationType")!.Value);
        Assert.Equal("thirteen://day/2026-10-21", toast.Attribute("launch")!.Value);
        Assert.Equal("ToastGeneric", toast.Element("visual")!.Element("binding")!.Attribute("template")!.Value);
        Assert.Equal(["Flight <TLL> & \"HEL\"", "10:00 to 12:00, Gate 3"], toast.Descendants("text").Select(t => t.Value).ToArray());
        Assert.Equal("Thirteen", XDocument.Parse(AlertPlanner.ToastXml("", "All day", new Thirteen.Core.GregorianDate(2026, 10, 22))).Descendants("text").First().Value);
        // The launch is a link Thirteen opens (a click starts it, or reaches the running one).
        Assert.Equal(new Thirteen.Core.GregorianDate(2026, 10, 21), Support.DeepLink.TryParse(toast.Attribute("launch")!.Value)!.Day);
    }

    [Fact]
    public async Task Plan_LeavesOutSubscriptionsAndHiddenCalendars()
    {
        using var folder = new TempFolder();
        var hidden = Calendar("Hidden", Event("h1", "Hidden alert", "DTSTART" + Tallinn("20261021T100000"), "DTEND" + Tallinn("20261021T110000"), "", Alarm("TRIGGER:-PT5M")));
        using var store = await StoreWith(folder, (CalendarId, Alerts), ("hidden-0001", hidden));
        Assert.Contains(AlertPlanner.Plan(store, StoreTesting.Now, true), a => a.Title == "Hidden alert");
        await store.UpdateRecordAsync("hidden-0001", r => r with { Visible = false });
        var feed = Calendar("Feed", Event("f1", "Feed alert", "DTSTART" + Tallinn("20261021T100000"), "DTEND" + Tallinn("20261021T110000"), "", Alarm("TRIGGER:-PT5M")));
        await store.CreateSubscriptionAsync("Feed", "#57534e", new SubscriptionRecord { Url = "https://calendar.example.com/feed.ics", Interval = SubscriptionIntervals.Daily }, feed, "feed-0001");
        var plan = AlertPlanner.Plan(store, StoreTesting.Now, true);
        Assert.DoesNotContain(plan, a => a.Title is "Hidden alert" or "Feed alert");
        Assert.Contains(plan, a => a.Title == "Standup");
    }

    [Fact]
    public async Task Plan_IsCappedAtAThousand_EarliestFirst()
    {
        using var folder = new TempFolder();
        var alarms = Enumerable.Range(1, 20).Select(n => Alarm($"TRIGGER:-PT{n}M")).ToArray();
        var busy = Calendar("Busy", Event("daily", "Daily", "DTSTART" + Tallinn("20261020T120000"), "DTEND" + Tallinn("20261020T121500"), "RRULE:FREQ=DAILY\r\n", alarms));
        using var store = await StoreWith(folder, (CalendarId, busy));
        var plan = AlertPlanner.Plan(store, StoreTesting.Now, true);
        Assert.Equal(AlertPlanner.MaxAlerts, plan.Count);
        Assert.Equal(plan.OrderBy(a => a.FireAt).Select(a => a.Id), plan.Select(a => a.Id));
        Assert.Equal(Utc("2026-10-20T08:40"), plan[0].FireAt);
        Assert.True(plan[^1].FireAt < Utc("2026-12-18T06:41"));
    }

    [Fact]
    public async Task Plan_FollowsTheDeviceZone()
    {
        using var folder = new TempFolder();
        File.WriteAllText(folder.File(CalendarId + ".ics"), Alerts, new UTF8Encoding(false));
        var zone = StoreTesting.Tallinn;
        using var store = new EventStore(folder.Path, WindowsZoneResolver.Shared, () => zone, new FixedTimeProvider(StoreTesting.Now));
        await store.LoadAsync();
        var birthday = AlertPlanner.Plan(store, StoreTesting.Now, true).Single(a => a.Title == "Mari's birthday");
        Assert.Equal(Utc("2026-10-21T06:00"), birthday.FireAt);
        // Flown to New York: an all-day event's alert is 09:00 there; a zoned event keeps its instant.
        zone = "America/New_York";
        store.DeviceZoneChanged();
        var plan = AlertPlanner.Plan(store, StoreTesting.Now, true);
        Assert.Equal(Utc("2026-10-21T13:00"), plan.Single(a => a.Title == "Mari's birthday").FireAt);
        Assert.Equal(Utc("2026-10-21T08:30"), plan.Single(a => a.Title.StartsWith("Flight", StringComparison.Ordinal)).FireAt);
        Assert.Equal("03:00 to 05:00, Gate 3", plan.Single(a => a.Title.StartsWith("Flight", StringComparison.Ordinal)).Body);
    }

    // ---- The scheduler ------------------------------------------------------------------------------------

    private sealed class FakeToasts : IToastPlatform
    {
        public bool IsAvailable { get; set; } = true;

        public Dictionary<string, ScheduledToast> Scheduled { get; } = new(StringComparer.Ordinal);

        public int Added { get; private set; }

        public int Removed { get; private set; }

        public int Schedule(IReadOnlyList<ScheduledToast> toasts)
        {
            lock (Scheduled)
            {
                // As Windows: a scheduled toast's id has at most 15 characters, a longer one is refused (0x803E0120).
                var taken = toasts.Where(t => t.Id.Length <= 15).ToArray();
                foreach (var toast in taken) Scheduled[toast.Id] = toast;
                Added += taken.Length;
                return taken.Length;
            }
        }

        public int ClearAll()
        {
            lock (Scheduled)
            {
                var n = Scheduled.Count;
                Scheduled.Clear();
                return n;
            }
        }

        public IReadOnlyList<string> ScheduledIds()
        {
            lock (Scheduled) return Scheduled.Keys.ToArray();
        }

        public int Remove(IReadOnlyCollection<string> ids)
        {
            lock (Scheduled)
            {
                var n = ids.Count(Scheduled.Remove);
                Removed += n;
                return n;
            }
        }
    }

    [Fact]
    public async Task Scheduler_BringsWindowsScheduleInLine_AddingAndRemovingOnlyTheDifference()
    {
        using var folder = new TempFolder();
        using var store = await StoreWith(folder, (CalendarId, Alerts));
        var toasts = new FakeToasts();
        toasts.Schedule([new ScheduledToast("stale0000000000", "<toast/>", Utc("2026-10-25T10:00"))]);
        using var scheduler = new AlertScheduler(store, toasts, new FixedTimeProvider(StoreTesting.Now), () => true) { Debounce = TimeSpan.FromMilliseconds(50) };
        await scheduler.RebuildAsync();
        Assert.True(scheduler.IsEnabled);
        Assert.Equal(9, toasts.Scheduled.Count);
        Assert.DoesNotContain("stale0000000000", toasts.Scheduled.Keys);
        Assert.Equal(scheduler.LastPlan.Select(a => a.Id).Order(), toasts.Scheduled.Keys.Order());
        var flight = scheduler.LastPlan.Single(a => a.Title.StartsWith("Flight", StringComparison.Ordinal));
        Assert.Equal((flight.FireAt, flight.Xml), (toasts.Scheduled[flight.Id].DeliveryTime, toasts.Scheduled[flight.Id].Xml));

        // Unchanged: nothing added or removed.
        var (added, removed) = (toasts.Added, toasts.Removed);
        await scheduler.RebuildAsync();
        Assert.Equal((added, removed), (toasts.Added, toasts.Removed));

        // A changed event, after a store change: its old toast goes, its new one comes, the rest stay.
        scheduler.Start();
        var rebuilds = scheduler.Rebuilds;
        await store.UpdateGroupAsync(CalendarId, "sauna", (_, group) => group! with { Master = group.Master! with { Summary = "Sauna night" } });
        await StoreTesting.Eventually(() => scheduler.Rebuilds > rebuilds && scheduler.LastPlan.Any(a => a.Title == "Sauna night"), "the rebuild after the change");
        Assert.Equal(9, toasts.Scheduled.Count);
        Assert.Equal((added + 1, removed + 1), (toasts.Added, toasts.Removed));
    }

    [Fact]
    public async Task Scheduler_TurnsItselfOff_WhenToastsAreUnavailable()
    {
        using var folder = new TempFolder();
        using var store = await StoreWith(folder, (CalendarId, Alerts));
        var toasts = new FakeToasts { IsAvailable = false };
        using var scheduler = new AlertScheduler(store, toasts, new FixedTimeProvider(StoreTesting.Now), () => true);
        await scheduler.RebuildAsync();
        Assert.False(scheduler.IsEnabled);
        Assert.Empty(toasts.Scheduled);
        Assert.Equal(0, scheduler.Rebuilds);
    }

    [Fact]
    public void ClearAlerts_ExitsZero_EvenWithoutToasts()
    {
        Assert.Equal(-1, new NoToastPlatform().ClearAll());
        if (!OperatingSystem.IsWindows()) Assert.Equal(0, ToastPlatform.ClearAlertsCommand());
    }
}
