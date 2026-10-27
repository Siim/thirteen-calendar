using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The command line of §6.4: <c>.ics</c> paths and <c>--import</c> open Import, <c>webcal://</c> and
/// <c>thirteen://subscribe?url=</c> open Subscribe prefilled, a second start forwards them (files as full paths) to the
/// running instance, and <c>--fake-events</c> makes a read-only QA run.
/// </summary>
public class ExternalRequestTests
{
    private static readonly string WorkingFolder = Path.Combine(Path.GetTempPath(), "thirteen-args");

    [Theory]
    [InlineData("webcal://calendars.example.com/holidays.ics", "webcal://calendars.example.com/holidays.ics")]
    [InlineData("WEBCALS://calendars.example.com/h.ics", "WEBCALS://calendars.example.com/h.ics")]
    [InlineData("thirteen://subscribe?url=https%3A%2F%2Fcalendar.google.com%2Fcalendar%2Fical%2Fa%2540b%2Fbasic.ics", "https://calendar.google.com/calendar/ical/a%40b/basic.ics")]
    [InlineData("thirteen://subscribe/?url=webcal%3A%2F%2Fexample.com%2Fa.ics&x=1", "webcal://example.com/a.ics")]
    [InlineData("thirteen://subscribe", "")]
    public void SubscribeLinksArePrefilledAsGiven(string argument, string link)
    {
        var request = ExternalRequest.Parse(["--page", "year", argument, "notes.ics"], WorkingFolder);
        Assert.NotNull(request);
        Assert.Equal(ExternalKind.Subscribe, request!.Kind);      // a subscribe link wins over files
        Assert.Equal(link, request.Link);
        Assert.Empty(request.Files);
    }

    [Fact]
    public void FilesAndImportArgumentsBecomeFullPaths()
    {
        var request = ExternalRequest.Parse(["work.ics", "--import", "backup.zip", "PLAIN.ICAL", "notes.txt", "--page", "year", "work.ics", "free.ifb"], WorkingFolder)!;
        Assert.Equal(ExternalKind.Import, request.Kind);
        Assert.Null(request.Link);
        Assert.Equal(
            new[] { "work.ics", "backup.zip", "PLAIN.ICAL", "free.ifb" }.Select(f => Path.Combine(WorkingFolder, f)),
            request.Files);
        var absolute = Path.Combine(Path.GetTempPath(), "elsewhere", "family.ics");
        Assert.Equal([absolute], ExternalRequest.Parse([absolute], WorkingFolder)!.Files);
    }

    [Theory]
    [InlineData("thirteen://year/2024")]
    [InlineData("thirteen://today")]
    [InlineData("https://calendars.example.com/h.ics")]
    [InlineData("notes.txt")]
    [InlineData("--page")]
    public void OtherArgumentsAreNoRequest(string argument) => Assert.Null(ExternalRequest.Parse([argument], WorkingFolder));

    [Fact]
    public void ASecondStartForwardsLinksAndFullPaths()
    {
        var forwarded = ExternalRequest.Forwarded(
            ["--page", "year", "thirteen://year/2024", "webcal://example.com/a.ics", "family.ics", "bad\nline.ics", "notes.txt"], WorkingFolder);
        Assert.Equal(["thirteen://year/2024", "webcal://example.com/a.ics", Path.Combine(WorkingFolder, "family.ics")], forwarded);
        Assert.Empty(ExternalRequest.Forwarded(["--page", "year"], WorkingFolder));
    }

    [Fact]
    public void LaunchOptionsCarryTheRequestAndFakeEvents()
    {
        var subscribe = LaunchOptions.Parse(["thirteen://subscribe?url=webcal%3A%2F%2Fexample.com%2Fa.ics"]);
        Assert.Empty(subscribe.Errors);                // not reported as a bad thirteen:// link
        Assert.Null(subscribe.Link);
        Assert.Equal("webcal://example.com/a.ics", subscribe.External!.Link);
        Assert.False(subscribe.IsReadOnly);
        Assert.False(subscribe.FakeEvents);

        var fake = LaunchOptions.Parse(["--fake-events", "--page", "year"]);
        Assert.True(fake.FakeEvents);
        Assert.True(fake.IsReadOnly);
        Assert.Null(fake.External);
        Assert.Contains("--fake-events", LaunchOptions.QaSwitches);
        Assert.Single(LaunchOptions.Parse(["thirteen://nowhere"]).Errors);
    }

    [Fact]
    public async Task FakeEventsRunOnTheMockupDataSetWithoutRefreshes()
    {
        using var fake = EventsHost.Create(LaunchOptions.Parse(["--fake-events"]), "#b45309");
        Assert.IsType<FakeEventStore>(fake.Store);
        Assert.Null(fake.Store.Folder);
        await fake.StartAsync();
        Assert.Null(fake.LoadError);
        Assert.Equal(6, fake.Store.Calendars.Count);

        // A QA run reads the stored calendars without writing (not loaded here: it would read this machine's folder).
        using var qa = EventsHost.Create(LaunchOptions.Parse(["--page", "year"]), "#b45309");
        var store = Assert.IsType<EventStore>(qa.Store);
        Assert.True(store.IsReadOnly);
        Assert.Equal(EventStore.DefaultFolder, store.Folder);
        Assert.Equal("#b45309", store.DefaultColor);
    }
}

/// <summary>A second start hands its subscribe link and files to the running instance (§6.4 SingleInstance).</summary>
[Collection(nameof(ProcessWideCollection))]
public class SingleInstanceArgumentsTests
{
    [Fact]
    public void ASecondStartHandsOverItsArguments()
    {
        using var first = SingleInstance.Start(null, out var handedOver);
        Assert.NotNull(first);
        Assert.False(handedOver);
        var links = new List<string?>();
        var arguments = new List<IReadOnlyList<string>>();
        using var got = new CountdownEvent(2);
        first.Received += link =>
        {
            lock (links) links.Add(link);
            got.Signal();
        };
        first.ArgumentsReceived += list =>
        {
            lock (arguments) arguments.Add(list);
            got.Signal();
        };
        var file = Path.Combine(Path.GetTempPath(), "family.ics");
        Assert.Null(SingleInstance.StartWith(["thirteen://year/2024", "webcal://example.com/a.ics", file], out var second));
        Assert.True(second);
        Assert.True(got.Wait(TimeSpan.FromSeconds(5)));
        lock (links) Assert.Equal(["thirteen://year/2024"], links);
        lock (arguments) Assert.Equal([["webcal://example.com/a.ics", file]], arguments);
    }
}
