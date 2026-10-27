using System.Text.Json;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// <see cref="FakeEventStore"/> loads the mockup data set (fixtures/mockup/mockup-events.json, §6.7) from the app's
/// embedded resource and expands it through the same code as the real store; its occurrences must equal the ones the
/// generator wrote into the file.
/// </summary>
public class FakeEventStoreTests
{
    [Fact]
    public void TheEmbeddedResourceIsTheFixtureFile() =>
        Assert.Equal(RepoPaths.ReadFixture("mockup", "mockup-events.json"), FakeEventStore.ReadResource());

    [Fact]
    public async Task TheCalendarsAreLocalCalendarsAndSubscriptions()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        Assert.Equal(["Home", "Family", "Work", "Running club", "Holidays in Estonia", "Birthdays"], store.Calendars.Select(c => c.Name));
        Assert.Equal(4, store.Calendars.Count(c => c.IsWritable));
        Assert.True(store.Find("holidays")!.IsSubscription);
        Assert.Equal("#57534e", store.Find("holidays")!.Color);
        Assert.Equal("Europe/Tallinn", store.DeviceZone);
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 6, 41, 0, TimeSpan.Zero), store.Now);
        Assert.Null(store.Folder);
    }

    [Fact]
    public async Task ItsOccurrencesAreTheDataSetsOwn()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        using var json = JsonDocument.Parse(FakeEventStore.ReadResource());
        var window = json.RootElement.GetProperty("window");
        var from = LocalDateTime.Parse(window.GetProperty("from").GetString()!);
        var to = LocalDateTime.Parse(window.GetProperty("to").GetString()!);
        var expected = json.RootElement.GetProperty("occurrences").EnumerateArray()
            .Select(o => $"{o.GetProperty("key").GetString()} {o.GetProperty("title").GetString()} {o.GetProperty("allDay").GetBoolean()} {o.GetProperty("start").GetString()} {o.GetProperty("end").GetString()}")
            .Order(StringComparer.Ordinal)
            .ToList();
        var actual = store.Occurrences(from, to)
            .Select(o => $"{o.Key} {o.Title} {o.AllDay} {o.Start} {o.End}")
            .Order(StringComparer.Ordinal)
            .ToList();
        Assert.Equal(405, expected.Count);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public async Task WritesStayInMemory()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        var day = store.Occurrences(LocalDateTime.Parse("2026-10-19T00:00"), LocalDateTime.Parse("2026-10-20T00:00"));
        Assert.Contains(day, o => o.Title == "Dentist, Dr. Tamm");
        await store.UpdateGroupAsync("home", "dentist", (_, _) => null);
        day = store.Occurrences(LocalDateTime.Parse("2026-10-19T00:00"), LocalDateTime.Parse("2026-10-20T00:00"));
        Assert.DoesNotContain(day, o => o.Title == "Dentist, Dr. Tamm");
        var refused = await Assert.ThrowsAsync<EventStoreException>(() => store.UpdateGroupAsync("holidays", "halloween", (_, _) => null));
        Assert.Equal(StoreFailure.ReadOnly, refused.Failure);
    }

    [Fact]
    public async Task HiddenCalendarsAreNotFetched()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        await store.UpdateRecordAsync("work", r => r with { Visible = false });
        var week = store.Occurrences(LocalDateTime.Parse("2026-10-19T00:00"), LocalDateTime.Parse("2026-10-26T00:00"));
        Assert.DoesNotContain(week, o => o.CalendarId == "work");
        Assert.Contains(store.Occurrences(LocalDateTime.Parse("2026-10-19T00:00"), LocalDateTime.Parse("2026-10-26T00:00"), includeHidden: true), o => o.CalendarId == "work");
    }

    [Fact]
    public async Task TheSystemAndTheZoneAreCachedPerYear()
    {
        var store = new FakeEventStore();
        await store.LoadAsync();
        var first = store.Occurrences(LocalDateTime.Parse("2026-10-01T00:00"), LocalDateTime.Parse("2026-11-01T00:00"));
        var again = store.Occurrences(LocalDateTime.Parse("2026-10-01T00:00"), LocalDateTime.Parse("2026-11-01T00:00"));
        Assert.Equal(first.Select(o => o.Key), again.Select(o => o.Key));
        Assert.Same(first.First(o => o.Title == "Rent"), again.First(o => o.Title == "Rent"));
        store.System = CalendarSystemId.Positivist;
        var positivist = store.Occurrences(LocalDateTime.Parse("2026-10-01T00:00"), LocalDateTime.Parse("2026-11-01T00:00"));
        Assert.Equal(first.Select(o => o.Key), positivist.Select(o => o.Key));
        Assert.NotSame(first.First(o => o.Title == "Rent"), positivist.First(o => o.Title == "Rent"));
    }
}
