using System.Text;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using static Thirteen.Desktop.Tests.Events.StoreTesting;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// <see cref="EventStore"/> on a temporary folder (docs/EVENTS.md §3.6, §2.16, §6.4 "Tests"): atomic writes with
/// File.Move and File.Replace, recovery, read-only unreadable calendars, one process at a time, byte-for-byte groups,
/// racing writers, changes outside Thirteen and the watcher.
/// </summary>
public class EventStoreTests
{
    private static async Task<(EventStore Store, CalendarState Calendar)> NewStore(TempFolder folder, FixedTimeProvider? time = null)
    {
        var store = Store(folder, time);
        await store.LoadAsync();
        return (store, store.Calendars.Single());
    }

    [Fact]
    public async Task FirstUseCreatesPersonalAndWritesCalendarsJsonOnly()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        Assert.Equal("Personal", personal.Name);
        Assert.Equal(CalendarKinds.Local, personal.Record.Kind);
        Assert.True(personal.IsWritable);
        Assert.Equal(0, personal.EventCount);
        Assert.True(File.Exists(folder.File("calendars.json")));
        Assert.False(File.Exists(folder.File(personal.Id + ".ics")));      // written with its first event
        var json = File.ReadAllText(folder.File("calendars.json"));
        Assert.Contains("\"version\": 1", json, StringComparison.Ordinal);
        Assert.Contains("\"kind\": \"local\"", json, StringComparison.Ordinal);
        Assert.Contains("\"subscription\": null", json, StringComparison.Ordinal);
        Assert.Contains("\"createdAt\": \"2026-10-19T06:41:00Z\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheFirstWriteMovesTheTemporaryFileAndLaterWritesReplaceItKeepingABackup()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        var path = folder.File(personal.Id + ".ics");

        await Put(store, personal.Id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
        Assert.True(File.Exists(path));
        Assert.False(File.Exists(path + ".bak"));      // File.Move: nothing to keep
        Assert.False(File.Exists(path + ".tmp"));
        var first = File.ReadAllBytes(path);
        var text = Encoding.UTF8.GetString(first);
        Assert.StartsWith("BEGIN:VCALENDAR\r\n", text, StringComparison.Ordinal);
        Assert.Contains("PRODID:-//Haugas Development OU//Thirteen 1.0//EN\r\n", text, StringComparison.Ordinal);
        Assert.Contains("X-WR-CALNAME:Personal\r\n", text, StringComparison.Ordinal);
        Assert.Contains($"X-THIRTEEN-CALENDAR-ID:{personal.Id}\r\n", text, StringComparison.Ordinal);
        Assert.Contains("BEGIN:VTIMEZONE\r\nTZID:Europe/Tallinn\r\n", text, StringComparison.Ordinal);
        Assert.NotEqual(0xEF, first[0]);                // no byte order mark

        await Put(store, personal.Id, Timed("b", "Lunch with Jaan", "2026-10-16T12:00", "2026-10-16T13:00"));
        Assert.True(File.Exists(path + ".bak"));        // File.Replace keeps the previous version
        Assert.Equal(first, File.ReadAllBytes(path + ".bak"));
        Assert.Equal(2, store.Find(personal.Id)!.EventCount);
        Assert.False(File.Exists(path + ".tmp"));
    }

    [Fact]
    public async Task ADeletedFileIsWrittenAgain()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        var path = folder.File(personal.Id + ".ics");
        await Put(store, personal.Id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
        await Put(store, personal.Id, Timed("b", "Lunch", "2026-10-16T12:00", "2026-10-16T13:00"));
        File.Delete(path);
        File.Delete(path + ".bak");

        // The user deleted the file: the change is applied to what is on disk now (nothing), through File.Move.
        await Put(store, personal.Id, Timed("c", "Yoga", "2026-10-20T07:15", "2026-10-20T08:15"));
        Assert.True(File.Exists(path));
        Assert.False(File.Exists(path + ".bak"));
        var stored = store.Find(personal.Id)!.Document!;
        Assert.Equal(["c"], stored.Groups.Select(g => g.Uid));
    }

    [Fact]
    public async Task EditsAndSpansAcrossTheYearReadBackAsOccurrences()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        await Put(store, personal.Id, AllDay("winter", "Winter break", "2026-12-28", "2027-01-03"));
        await Put(store, personal.Id, Timed("nye", "New Year's Eve dinner", "2026-12-31T19:00", "2026-12-31T23:30"));
        await store.UpdateGroupAsync(personal.Id, "nye", (_, group) =>
            group! with { Master = EventEdits.Touch(group.Master! with { Summary = "Dinner" }, At("2026-10-19T06:41")) });

        var january = store.Occurrences(At("2027-01-01T00:00"), At("2027-01-08T00:00"));
        var winter = Assert.Single(january);
        Assert.Equal($"{personal.Id}/winter|2026-12-28", winter.Key);
        Assert.Equal(At("2026-12-28T00:00"), winter.Start);
        Assert.Equal(At("2027-01-03T24:00"), winter.End);

        var week = store.Occurrences(At("2026-12-28T00:00"), At("2027-01-04T00:00"));
        Assert.Equal(["Winter break", "Dinner"], week.Select(o => o.Title));
        var dinner = store.FindGroup(personal.Id, "nye")!.Master!;
        Assert.Equal(1, dinner.Sequence);
        Assert.Contains("SUMMARY:Dinner\r\n", dinner.Raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ABrokenFileIsRecoveredFromItsBackupAndRenamed()
    {
        using var folder = new TempFolder();
        string id;
        string path;
        {
            var (store, personal) = await NewStore(folder);
            using var _ = store;
            id = personal.Id;
            path = folder.File(id + ".ics");
            await Put(store, id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
            await Put(store, id, Timed("b", "Lunch", "2026-10-16T12:00", "2026-10-16T13:00"));
        }
        File.WriteAllText(path, "this is not a calendar");

        var time = new FixedTimeProvider(Now);
        using var reopened = Store(folder, time);
        await reopened.LoadAsync();
        var calendar = reopened.Find(id)!;
        Assert.Equal(CalendarNotice.Recovered, calendar.Notice);
        Assert.True(calendar.IsWritable);
        Assert.Equal(["a"], calendar.Document!.Groups.Select(g => g.Uid));     // the last saved copy (.bak)
        Assert.False(File.Exists(path));
        Assert.Equal("this is not a calendar", File.ReadAllText(path + ".broken-20261019064100"));
        Assert.True(File.Exists(path + ".bak"));

        // The next save writes the file again from the restored copy.
        await Put(reopened, id, Timed("c", "Yoga", "2026-10-20T07:15", "2026-10-20T08:15"));
        Assert.Equal(["a", "c"], reopened.Find(id)!.Document!.Groups.Select(g => g.Uid));
        Assert.True(File.Exists(path));
        Assert.Equal(CalendarNotice.Recovered, reopened.Find(id)!.Notice);
    }

    [Fact]
    public async Task ACalendarWithBothFilesUnreadableStaysReadOnlyAndItsDeleteMovesTheFilesAside()
    {
        using var folder = new TempFolder();
        string id;
        {
            var (store, personal) = await NewStore(folder);
            using var _ = store;
            id = personal.Id;
            await Put(store, id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
            await Put(store, id, Timed("b", "Lunch", "2026-10-16T12:00", "2026-10-16T13:00"));
        }
        var path = folder.File(id + ".ics");
        File.WriteAllText(path, "broken");
        File.WriteAllText(path + ".bak", "also broken");

        using var reopened = Store(folder);
        await reopened.LoadAsync();
        var calendar = reopened.Find(id)!;
        Assert.Equal(CalendarNotice.Unreadable, calendar.Notice);
        Assert.True(calendar.IsUnreadable);
        Assert.False(calendar.IsWritable);
        Assert.Equal("Personal", calendar.Name);           // still in the list
        var refused = await Assert.ThrowsAsync<EventStoreException>(() => Put(reopened, id, Timed("c", "Yoga", "2026-10-20T07:15", "2026-10-20T08:15")));
        Assert.Equal(StoreFailure.ReadOnly, refused.Failure);
        Assert.Equal("broken", File.ReadAllText(path));     // never written
        Assert.Equal("also broken", File.ReadAllText(path + ".bak"));

        await reopened.DeleteCalendarAsync(id);
        Assert.Null(reopened.Find(id));
        Assert.False(File.Exists(path));
        Assert.Equal("broken", File.ReadAllText(Path.Combine(folder.Path, "Unreadable", id + ".ics")));
        Assert.Equal("also broken", File.ReadAllText(Path.Combine(folder.Path, "Unreadable", id + ".ics.bak")));
    }

    [Fact]
    public async Task ASecondStoreOnTheSameFolderIsRefused()
    {
        using var folder = new TempFolder();
        var (store, _) = await NewStore(folder);
        using (store)
        {
            using var second = Store(folder);
            var refused = await Assert.ThrowsAsync<EventStoreException>(() => second.LoadAsync());
            Assert.Equal(StoreFailure.Storage, refused.Failure);
        }
        // Released when the first closes.
        using var third = Store(folder);
        await third.LoadAsync();
        Assert.Single(third.Calendars);
    }

    [Fact]
    public async Task EditingOneEventOfTheOutlookFileLeavesEveryOtherGroupByteForByte()
    {
        using var folder = new TempFolder();
        const string id = "outlook-publish";
        var original = RepoPaths.ReadFixture("ics", "cases", "outlook-publish.ics");
        File.WriteAllText(folder.File(id + ".ics"), original);
        var index = new CalendarIndexDocument
        {
            Calendars = [new CalendarRecord { Id = id, Kind = CalendarKinds.Local, Name = "Calendar", Color = "#2563eb", CreatedAt = "2026-10-18T12:00:00Z" }],
        };
        File.WriteAllBytes(folder.File("calendars.json"), index.ToUtf8());

        using var store = Store(folder);
        await store.LoadAsync();
        const string uid = "040000008200E00074C5B7101A82E00800000000F5FEF2D3411C6F9EE58779471EC2C3AD38A95A4F6C94689D82BAB67E";
        await store.UpdateGroupAsync(id, uid, (_, group) => group! with
        {
            Master = group.Master! with
            {
                Summary = "Budget review with Marta",
                Sequence = 1,
                LastModified = new IcsDateValue.UtcValue(At("2026-10-19T06:41")),
                Raw = null,
            },
        });

        var written = File.ReadAllText(folder.File(id + ".ics"));
        var expected = Components(RepoPaths.ReadFixture("ics", "edits", "outlook-edit-one.ics"));
        var actual = Components(written);
        Assert.Equal(expected.Keys.Order(), actual.Keys.Order());
        foreach (var (key, block) in expected) Assert.Equal(block, actual[key]);     // every group and the VTIMEZONE as the fixture says
        var before = Components(original.ReplaceLineEndings("\r\n"));
        var untouched = before.Keys.Where(k => !k.Contains(uid, StringComparison.Ordinal)).ToList();
        Assert.True(untouched.Count >= 4);
        foreach (var key in untouched) Assert.Equal(before[key], actual[key]);      // byte for byte as read
        Assert.Contains("TZID=FLE Standard Time", written, StringComparison.Ordinal);
        Assert.Equal(original.ReplaceLineEndings("\r\n"), File.ReadAllText(folder.File(id + ".ics.bak")).ReplaceLineEndings("\r\n"));
    }

    [Fact]
    public async Task KeptComponentsAndTheZonesTheyUseSurviveAnEditOfAnotherGroup()
    {
        // §3.6 and v3.3 §9.10: what Thirteen does not model (a VTODO, an unreadable VEVENT) is written back as read, in
        // its place, with the VTIMEZONE only the VTODO uses; a known zone used without a VTIMEZONE gets a generated one on
        // the first write of another app's file; only the edited group is serialized again.
        using var folder = new TempFolder();
        const string id = "mixed";
        const string zone = "BEGIN:VTIMEZONE\r\nTZID:Office Time\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0300\r\nTZOFFSETTO:+0300\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
        const string todo = "BEGIN:VTODO\r\nUID:todo-1@other\r\nDTSTAMP:20261001T090000Z\r\nDUE;TZID=Office Time:20261101T170000\r\nSUMMARY:File the report\r\nEND:VTODO\r\n";
        const string broken = "BEGIN:VEVENT\r\nUID:broken-1@other\r\nDTSTAMP:20261001T090000Z\r\nSUMMARY:No start\r\nEND:VEVENT\r\n";
        const string kept = "BEGIN:VEVENT\r\nUID:keep-1@other\r\nDTSTAMP:20261001T090000Z\r\nDTSTART;TZID=Europe/Tallinn:20261102T110000\r\nDTEND;TZID=Europe/Tallinn:20261102T120000\r\nSUMMARY:Kept as read\r\nX-OTHER-APP:1\r\nEND:VEVENT\r\n";
        const string edited = "BEGIN:VEVENT\r\nUID:edit-1@other\r\nDTSTAMP:20261001T090000Z\r\nDTSTART:20261103T090000Z\r\nDTEND:20261103T100000Z\r\nSUMMARY:Edit me\r\nEND:VEVENT\r\n";
        var original = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other App//EN\r\nX-WR-CALNAME:Mixed\r\n" + zone + todo + broken + kept + edited + "END:VCALENDAR\r\n";
        File.WriteAllText(folder.File(id + ".ics"), original);
        var index = new CalendarIndexDocument
        {
            Calendars = [new CalendarRecord { Id = id, Kind = CalendarKinds.Local, Name = "Mixed", Color = "#2563eb", CreatedAt = "2026-10-18T12:00:00Z" }],
        };
        File.WriteAllBytes(folder.File("calendars.json"), index.ToUtf8());

        using var store = Store(folder);
        await store.LoadAsync();
        Assert.Equal(2, store.Find(id)!.EventCount);
        await store.UpdateGroupAsync(id, "edit-1@other", (_, group) => group! with
        {
            Master = group.Master! with { Summary = "Edited in Thirteen", Sequence = 1, LastModified = new IcsDateValue.UtcValue(At("2026-10-19T06:41")), Raw = null },
        });

        var written = File.ReadAllText(folder.File(id + ".ics"));
        foreach (var block in new[] { zone, todo, broken, kept }) Assert.Contains(block, written, StringComparison.Ordinal);
        Assert.True(written.IndexOf(todo, StringComparison.Ordinal) < written.IndexOf(broken, StringComparison.Ordinal)
                    && written.IndexOf(broken, StringComparison.Ordinal) < written.IndexOf(kept, StringComparison.Ordinal), "kept in the order read");
        Assert.DoesNotContain("SUMMARY:Edit me", written, StringComparison.Ordinal);
        Assert.Contains("SUMMARY:Edited in Thirteen", written, StringComparison.Ordinal);
        Assert.Contains("BEGIN:VTIMEZONE\r\nTZID:Europe/Tallinn\r\n", written, StringComparison.Ordinal);
        Assert.Contains("X-THIRTEEN-GENERATED:", written, StringComparison.Ordinal);
        Assert.Equal(original, File.ReadAllText(folder.File(id + ".ics.bak")));

        // Read again from the file: the same events, the same kept components.
        using var again = Store(folder);
        store.Dispose();
        await again.LoadAsync();
        var document = again.Find(id)!.Document!;
        Assert.Equal(["keep-1@other", "edit-1@other"], document.Groups.Select(g => g.Uid));
        Assert.Equal(["VTODO", "VEVENT"], document.Others.Select(o => o.Name));
    }

    [Fact]
    public async Task AUiSaveRacingAnImportAndASubscriptionRefreshLosesNeither()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        var feed = RepoPaths.ReadFixture("ics", "cases", "google-holidays.ics");
        var subscription = await store.CreateSubscriptionAsync("Holidays", "#57534e", new SubscriptionRecord { Url = "https://example.com/h.ics" }, feed);
        var import = RepoPaths.ReadFixture("ics", "cases", "icloud-export.ics");

        var tasks = new List<Task>();
        for (var round = 0; round < 6; round++)
        {
            var n = round;
            tasks.Add(Task.Run(() => Put(store, personal.Id, Timed($"ui-{n}", $"Saved {n}", "2026-10-19T09:00", "2026-10-19T10:00"))));
            tasks.Add(Task.Run(() => store.UpdateDocumentAsync(personal.Id, document => IcsMerge.ImportCalendar(document, import, personal.Id, store.Zones).Calendar)));
            tasks.Add(Task.Run(() => store.UpdateSubscriptionAsync(subscription.Id, record => new SubscriptionUpdate(
                record with { Subscription = record.Subscription! with { LastAttemptAt = $"2026-10-19T06:4{n}:00.000Z", Etag = $"\"v{n}\"" } },
                n % 2 == 0 ? feed : null))));
            tasks.Add(Task.Run(() => store.UpdateRecordAsync(personal.Id, record => record with { Name = $"Personal {n}" })));
        }
        await Task.WhenAll(tasks);

        var stored = store.Find(personal.Id)!.Document!;
        var imported = IcsReader.Parse(import);
        foreach (var round in Enumerable.Range(0, 6)) Assert.Contains(stored.Groups, g => g.Uid == $"ui-{round}");
        foreach (var group in imported.Groups) Assert.Contains(stored.Groups, g => g.Uid == group.Uid);
        // What is on disk is what the store holds.
        var reread = IcsReader.Parse(File.ReadAllText(folder.File(personal.Id + ".ics")));
        Assert.Equal(stored.Groups.Select(g => g.Uid).Order(), reread.Groups.Select(g => g.Uid).Order());
        var index = CalendarIndexDocument.FromUtf8(File.ReadAllBytes(folder.File("calendars.json")))!;
        var record = index.Calendars.Single(c => c.Id == subscription.Id);
        Assert.StartsWith("\"v", record.Subscription!.Etag, StringComparison.Ordinal);
        Assert.StartsWith("Personal ", index.Calendars.Single(c => c.Id == personal.Id).Name, StringComparison.Ordinal);
        Assert.Equal(store.Find(personal.Id)!.Name, index.Calendars.Single(c => c.Id == personal.Id).Name);
    }

    [Fact]
    public async Task AFileChangedOutsideThirteenIsReloadedAndTheSaveAppliedToIt()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        await Put(store, personal.Id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
        var path = folder.File(personal.Id + ".ics");

        // Another program (or the user after "Open folder") adds an event to the file.
        var outside = IcsGroups.ReplaceGroup(IcsReader.Parse(File.ReadAllText(path)), Group(Timed("outside", "Added in Notepad", "2026-10-21T10:00", "2026-10-21T11:00")));
        File.WriteAllText(path, IcsWriter.Serialize(outside, store.Zones));

        await Put(store, personal.Id, Timed("b", "Lunch", "2026-10-16T12:00", "2026-10-16T13:00"));
        var calendar = store.Find(personal.Id)!;
        Assert.Equal(["a", "outside", "b"], calendar.Document!.Groups.Select(g => g.Uid));
        Assert.Equal(CalendarNotice.Reloaded, calendar.Notice);
        Assert.Contains("SUMMARY:Added in Notepad", File.ReadAllText(path), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheWatcherIgnoresThirteensOwnWritesAndReloadsOthers()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        var reloads = new List<string>();
        store.ReloadedFromDisk += id =>
        {
            lock (reloads) reloads.Add(id);
        };
        await Put(store, personal.Id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
        await Put(store, personal.Id, Timed("b", "Lunch", "2026-10-16T12:00", "2026-10-16T13:00"));
        Assert.False(await store.CheckOutsideChangeAsync(personal.Id));    // its own write: same hash
        await Task.Delay(1200);                                               // let the watcher see both writes
        lock (reloads) Assert.Empty(reloads);
        Assert.Equal(CalendarNotice.None, store.Find(personal.Id)!.Notice);

        var path = folder.File(personal.Id + ".ics");
        var outside = IcsGroups.RemoveGroup(IcsReader.Parse(File.ReadAllText(path)), "a");
        File.WriteAllText(path, IcsWriter.Serialize(outside, store.Zones));
        await Eventually(() =>
        {
            lock (reloads) return reloads.Count == 1;
        }, "the watcher reloads the calendar changed outside Thirteen");
        var calendar = store.Find(personal.Id)!;
        Assert.Equal(CalendarNotice.Reloaded, calendar.Notice);
        Assert.Equal(["b"], calendar.Document!.Groups.Select(g => g.Uid));
    }

    [Fact]
    public async Task AnUnreadableCalendarJsonFallsBackToItsBackupAndThenToTheFiles()
    {
        using var folder = new TempFolder();
        string id;
        {
            var (store, personal) = await NewStore(folder);
            using var _ = store;
            id = personal.Id;
            await Put(store, id, Timed("a", "Dentist", "2026-10-19T15:40", "2026-10-19T16:20"));
            await store.UpdateRecordAsync(id, r => r with { Name = "Home" });       // calendars.json written twice: .bak exists
        }
        File.WriteAllText(folder.File("calendars.json"), "{ not json");
        {
            using var store = Store(folder);
            await store.LoadAsync();
            Assert.Equal(id, Assert.Single(store.Calendars).Id);
            Assert.Equal("Personal", store.Calendars[0].Name);      // the backup: the version before the rename
        }
        File.WriteAllText(folder.File("calendars.json"), "{ not json");
        File.WriteAllText(folder.File("calendars.json.bak"), "nor this");
        {
            using var store = Store(folder);
            await store.LoadAsync();
            var rebuilt = Assert.Single(store.Calendars);
            Assert.Equal(id, rebuilt.Id);
            Assert.Equal(1, rebuilt.EventCount);
        }
    }

    [Fact]
    public async Task SubscriptionsAreStoredAsFetchedWithTheOldCopyAsBackup()
    {
        using var folder = new TempFolder();
        var (store, _) = await NewStore(folder);
        using var __ = store;
        var first = RepoPaths.ReadFixture("ics", "cases", "google-secret.ics");
        var subscription = await store.CreateSubscriptionAsync("Work", "#2563eb", new SubscriptionRecord { Url = "https://example.com/w.ics" }, first);
        var path = folder.File(subscription.Id + ".ics");
        Assert.Equal(first, File.ReadAllText(path));                      // exactly as fetched, line ends included
        var refused = await Assert.ThrowsAsync<EventStoreException>(() => Put(store, subscription.Id, Timed("x", "X", "2026-10-19T09:00", "2026-10-19T10:00")));
        Assert.Equal(StoreFailure.ReadOnly, refused.Failure);

        var second = RepoPaths.ReadFixture("ics", "cases", "google-holidays.ics");
        Assert.True(await store.UpdateSubscriptionAsync(subscription.Id, r => new SubscriptionUpdate(r, second)));
        Assert.Equal(second, File.ReadAllText(path));
        Assert.Equal(first, File.ReadAllText(path + ".bak"));
        Assert.True(store.Find(subscription.Id)!.EventCount > 10);
    }

    [Fact]
    public async Task AReadOnlyStoreNeverWrites()
    {
        using var folder = new TempFolder();
        using var store = Store(folder, readOnly: true);
        await store.LoadAsync();
        Assert.Empty(store.Calendars);
        Assert.Empty(Directory.EnumerateFileSystemEntries(folder.Path));
        await Assert.ThrowsAsync<EventStoreException>(() => store.CreateCalendarAsync("Home"));
    }

    [Fact]
    public async Task EnsureLocalCalendarCreatesPersonalAgainWhenNoneIsLeft()
    {
        using var folder = new TempFolder();
        var (store, personal) = await NewStore(folder);
        using var _ = store;
        await store.DeleteCalendarAsync(personal.Id);
        Assert.Empty(store.Calendars);
        store.DefaultColor = "#4F46E5";
        var again = await store.EnsureLocalCalendarAsync();
        Assert.Equal("Personal", again.Name);
        Assert.Equal("#4f46e5", again.Color);
        Assert.NotEqual(personal.Id, again.Id);
        Assert.Same(again.Record, (await store.EnsureLocalCalendarAsync()).Record);
    }
}
