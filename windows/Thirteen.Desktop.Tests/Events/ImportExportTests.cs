using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// Import, restore and export through the real store (task W8, docs/EVENTS.md §2.17): every import and restore procedure
/// of fixtures/ics replayed through <see cref="ImportExport"/> and the store's read-modify-write, the stored file compared
/// byte for byte with the fixture; reading files (errors, zips, restore detection), new calendars, restoring the zip on
/// a fresh computer, export names and the export then restore round trip.
/// </summary>
public sealed class ImportExportTests
{
    private static readonly Encoding Utf8 = new UTF8Encoding(false);

    private static byte[] Bytes(string relative) => File.ReadAllBytes(RepoPaths.Fixture("ics", relative));

    private static ImportPlan Read(EventStoreBase store, params string[] relative) =>
        ImportExport.ReadFiles(relative.Select(r => (Path.GetFileName(r), (byte[]?)Bytes(r))).ToArray(), store.Zones);

    private static async Task<EventStore> Loaded(TempFolder folder)
    {
        var store = StoreTesting.Store(folder);
        await store.LoadAsync();
        return store;
    }

    // ---- The fixtures' procedures, through the store ---------------------------------------------------

    [Theory]
    [InlineData("imports/baseline.json")]
    [InlineData("imports/customized-tz.json")]
    [InlineData("imports/known-tz.json")]
    [InlineData("imports/missing-uid.json")]
    [InlineData("imports/override-only.json")]
    [InlineData("restore/restore.json")]
    public async Task Procedures_ThroughTheStore_WriteTheFixturesByteForByte(string procedure)
    {
        using var json = JsonDocument.Parse(Bytes(procedure));
        foreach (var scenario in json.RootElement.GetProperty("scenarios").EnumerateArray())
        {
            var name = scenario.GetProperty("name").GetString()!;
            var calendarId = scenario.GetProperty("calendarId").GetString()!;
            using var folder = new TempFolder();
            var start = scenario.GetProperty("start");
            if (start.TryGetProperty("file", out var startFile)) File.WriteAllBytes(folder.File(calendarId + ".ics"), Bytes(startFile.GetString()!));
            using var store = await Loaded(folder);
            if (start.TryGetProperty("new", out var fresh))
            {
                await store.CreateCalendarAsync(fresh.GetProperty("name").GetString()!, fresh.GetProperty("color").GetString(), calendarId);
            }
            Assert.NotNull(store.Find(calendarId));
            foreach (var step in scenario.GetProperty("steps").EnumerateArray())
            {
                var expected = step.GetProperty("expected").GetString()!;
                var context = $"{name}: {expected}";
                var path = store.DocumentPath(calendarId);
                switch (step.GetProperty("kind").GetString())
                {
                    case "edit":
                        // The edit itself is W7's; the committed document is what the next step starts from.
                        File.WriteAllBytes(path, Bytes(expected));
                        continue;
                    case "import":
                    {
                        var plan = Read(store, step.GetProperty("file").GetString()!);
                        Assert.False(plan.IsRestore, context);
                        var source = Assert.Single(plan.Sources);
                        var outcome = await ImportExport.ImportAsync(store, [new ImportChoice(source, ImportTarget.Existing(calendarId))]);
                        var result = step.GetProperty("result");
                        Assert.Equal(
                            (result.GetProperty("added").GetInt32(), result.GetProperty("updated").GetInt32(), result.GetProperty("unchanged").GetInt32(), result.GetProperty("skipped").GetInt32()),
                            (outcome.Added, outcome.Updated, outcome.Unchanged, outcome.Duplicates));
                        Assert.Equal([calendarId], outcome.CalendarIds);
                        break;
                    }
                    case "restore":
                    {
                        var plan = Read(store, step.GetProperty("file").GetString()!);
                        Assert.True(plan.IsRestore, context);
                        var outcome = await ImportExport.RestoreAsync(store, plan.Sources);
                        Assert.Equal(1, outcome.Calendars);
                        Assert.Equal(step.GetProperty("result").GetProperty("keptNewer").GetInt32(), outcome.KeptNewer);
                        Assert.Equal([calendarId], outcome.CalendarIds);
                        break;
                    }
                    default:
                        throw new InvalidDataException(context);
                }
                Assert.True(File.Exists(path), context);
                var written = File.ReadAllBytes(path);
                if (!written.AsSpan().SequenceEqual(Bytes(expected)))
                {
                    Assert.Fail($"{context} differs:\n{FirstDifference(Utf8.GetString(written), Utf8.GetString(Bytes(expected)))}");
                }
            }
        }
    }

    private static string FirstDifference(string actual, string expected)
    {
        var a = actual.Split("\r\n");
        var e = expected.Split("\r\n");
        for (var i = 0; i < Math.Max(a.Length, e.Length); i++)
        {
            var left = i < a.Length ? a[i] : "<end>";
            var right = i < e.Length ? e[i] : "<end>";
            if (left != right) return $"line {i + 1}: written \"{left}\", expected \"{right}\"";
        }
        return "(same lines)";
    }

    // ---- Several files into one calendar in one import ---------------------------------------------------

    [Fact]
    public async Task ThreeOutlookFiles_InOneImport_RenameTheCollidingZone()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        const string id = "314db1ef-adc1-4687-b7a6-cf3608976179";
        await store.CreateCalendarAsync("Outlook", "#2563eb", id);
        var plan = Read(store, "imports/customized-tz-a.ics", "imports/customized-tz-b.ics", "imports/customized-tz-c.ics");
        Assert.Equal(3, plan.Files.Count);
        Assert.Equal(3, plan.Sources.Count);
        var outcome = await ImportExport.ImportAsync(store, plan.Sources.Select(s => new ImportChoice(s, ImportTarget.Existing(id))).ToArray());
        Assert.Equal((3, 0, 0), (outcome.Added, outcome.Updated, outcome.Unchanged));
        Assert.Equal(Bytes("imports/customized-tz-3.ics"), File.ReadAllBytes(store.DocumentPath(id)));
        Assert.Contains("TZID:Customized Time Zone (2)", File.ReadAllText(store.DocumentPath(id)), StringComparison.Ordinal);
    }

    [Fact]
    public async Task RepeatedMastersAndUnreadableEvents_AreCountedInTheToast()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var plan = Read(store, "cases/duplicate-uid.ics", "cases/broken.ics");
        Assert.Equal(2, plan.Sources.Count);
        Assert.True(plan.Sources[1].Skipped > 0);
        var outcome = await ImportExport.ImportAsync(store, plan.Sources.Select(s => new ImportChoice(s, ImportTarget.New(s.CalendarName))).ToArray());
        // The engine's own counts, document by document.
        var duplicates = plan.Sources.Sum(s => IcsMerge.ImportCalendar(IcsGroups.NewCalendar("x", "x", "#2563eb"), s.Text, "x", store.Zones).Skipped);
        Assert.True(duplicates > 0);
        Assert.Equal(duplicates, outcome.Duplicates);
        Assert.Equal(plan.Sources[1].Skipped, outcome.Partial);
        Assert.Equal(2, outcome.CalendarIds.Count);
        var toast = ImportStrings.ImportToast(outcome);
        Assert.Contains(outcome.Partial == 1 ? "1 event couldn't be read and was skipped." : $"{outcome.Partial} events couldn't be read and were skipped.", toast, StringComparison.Ordinal);
        Assert.Contains(duplicates == 1 ? "1 repeated event in the file was skipped." : $"{duplicates} repeated events in the file were skipped.", toast, StringComparison.Ordinal);
        Assert.Equal(["Duplicates", "Broken"], outcome.CalendarIds.Select(id => store.Find(id)!.Name).ToArray());
    }

    [Fact]
    public async Task ImportIntoNewCalendar_CreatesItWithTheName()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var plan = Read(store, "cases/google-secret.ics");
        var source = Assert.Single(plan.Sources);
        Assert.True(source.Named);
        Assert.Equal("Liis Kask", source.CalendarName);
        var outcome = await ImportExport.ImportAsync(store, [new ImportChoice(source, ImportTarget.New(source.CalendarName))]);
        Assert.Equal(3, outcome.Added);
        var created = store.Find(Assert.Single(outcome.CalendarIds))!;
        Assert.Equal("Liis Kask", created.Name);
        Assert.Equal(3, created.EventCount);
        Assert.Equal(2, store.Calendars.Count); // Personal of first use, and the new one
        Assert.Equal("Added 3, updated 0, unchanged 0.", ImportStrings.ImportToast(outcome));
    }

    [Fact]
    public async Task ImportIntoSubscriptionOrMissingCalendar_Fails_AndLeavesNoNewCalendar()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var holidays = Read(store, "restore/Holidays in Estonia.ics").Sources[0];
        await ImportExport.RestoreAsync(store, [holidays]);
        var source = Read(store, "cases/google-secret.ics").Sources[0];
        var before = store.Calendars.Count;
        var readOnly = await Assert.ThrowsAsync<EventStoreException>(() => ImportExport.ImportAsync(store, [new ImportChoice(source, ImportTarget.Existing(holidays.Thirteen!.CalendarId))]));
        Assert.Equal(StoreFailure.ReadOnly, readOnly.Failure);
        var missing = await Assert.ThrowsAsync<EventStoreException>(() => ImportExport.ImportAsync(store, [new ImportChoice(source, ImportTarget.New("Liis")), new ImportChoice(source, ImportTarget.Existing("nope"))]));
        Assert.Equal(StoreFailure.NotFound, missing.Failure);
        // The first choice's new calendar was written; only a created calendar whose own import failed is removed.
        Assert.Equal(before + 1, store.Calendars.Count);
    }

    // ---- Reading files ----------------------------------------------------------------------------------

    [Fact]
    public void ReadFiles_ReportsNotIcsEmptyAndTooLarge()
    {
        var empty = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nEND:VCALENDAR\r\n"u8.ToArray();
        var plan = ImportExport.ReadFiles(
            [("notes.txt", "Shopping list\r\n- milk\r\n"u8.ToArray()), ("empty.ics", empty), ("huge.ics", null), ("broken.zip", [0x50, 0x4B, 3, 4, 1, 2, 3])],
            WindowsZoneResolver.Shared);
        Assert.Equal([ImportFileError.NotIcs, ImportFileError.Empty, ImportFileError.TooLarge, ImportFileError.NotIcs], plan.Files.Select(f => f.Error).ToArray());
        Assert.Empty(plan.Sources);
        Assert.False(plan.IsRestore);
        Assert.Equal("This file isn't a calendar (.ics) file.", ImportStrings.Error(ImportFileError.NotIcs));
        Assert.Equal("This file has no events.", ImportStrings.Error(ImportFileError.Empty));
    }

    [Fact]
    public void ReadFiles_CountsEventsAndNamesTheCalendar()
    {
        var plan = ImportExport.ReadFiles([("missing-uid.ics", Bytes("cases/missing-uid.ics")), ("Team offsite.ics", Bytes("imports/customized-tz-a.ics"))], WindowsZoneResolver.Shared);
        Assert.Equal(2, plan.Sources.Count);
        Assert.Equal(("Bookings", true, 2), (plan.Sources[0].CalendarName, plan.Sources[0].Named, plan.Sources[0].Events));
        Assert.Null(plan.Sources[0].Thirteen);
        Assert.False(plan.IsRestore);
        Assert.Equal("2 events in missing-uid.ics", ImportStrings.Summary(plan.Sources[0].Events, plan.Sources[0].Name));
    }

    [Fact]
    public void ReadFiles_TheBackupZip_IsARestoreOfThreeCalendars()
    {
        var plan = ImportExport.ReadFiles([("Thirteen calendars 2026-10-19.zip", Bytes("restore/Thirteen calendars 2026-10-19.zip"))], WindowsZoneResolver.Shared);
        Assert.True(plan.IsRestore);
        var file = Assert.Single(plan.Files);
        Assert.Null(file.Error);
        Assert.Equal(["Personal.ics", "Work.ics", "Holidays in Estonia.ics"], file.Sources.Select(s => s.Name).ToArray());
        Assert.Equal(["0/0", "0/1", "0/2"], file.Sources.Select(s => s.Id).ToArray());
        var info = file.Sources.Select(s => s.Thirteen!).ToArray();
        Assert.Equal(["0ab6ab60-378b-4c89-8a97-2770524d4fae", "4074b90e-c55e-46db-882c-8096d5beef46", "ac8b5389-489e-422e-b633-807e74445762"], info.Select(i => i.CalendarId).ToArray());
        Assert.Equal(["Personal", "Work", "Holidays in Estonia"], info.Select(i => i.Name).ToArray());
        Assert.Equal(["#ea580c", "#2563eb", "#57534e"], info.Select(i => i.Color ?? "").ToArray());
        Assert.Equal([false, false, true], info.Select(i => i.IsSubscription).ToArray());
        Assert.Equal(("https://calendar.example.com/holidays/ee.ics", "P1D"), (info[2].SubscriptionUrl, info[2].SubscriptionInterval));
        Assert.Equal([4, 2, 16], file.Sources.Select(s => s.Groups).ToArray());
    }

    [Fact]
    public void ReadFiles_AnExportWithAnotherFile_IsAnImport()
    {
        var plan = ImportExport.ReadFiles([("Personal.ics", Bytes("restore/Personal.ics")), ("missing-uid.ics", Bytes("cases/missing-uid.ics"))], WindowsZoneResolver.Shared);
        Assert.False(plan.IsRestore);
        Assert.Equal(2, plan.Sources.Count);
    }

    [Fact]
    public async Task ReadPathsAsync_ReadsFromDisk_AndAZipOfAnotherApp()
    {
        using var folder = new TempFolder();
        var zip = folder.File("calendars.zip");
        using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create))
        {
            archive.CreateEntryFromFile(RepoPaths.Fixture("ics", "cases", "missing-uid.ics"), "export/bookings.ics");
            archive.CreateEntry("export/readme.txt");
        }
        var plan = await ImportExport.ReadPathsAsync([zip, folder.File("gone.ics")], WindowsZoneResolver.Shared);
        Assert.Equal(2, plan.Files.Count);
        Assert.Equal("bookings.ics", Assert.Single(plan.Files[0].Sources).Name);
        Assert.NotNull(plan.Files[1].Error);
    }

    // ---- Restore -----------------------------------------------------------------------------------------

    [Fact]
    public async Task RestoreTheZip_OnAFreshComputer_GivesExactlyTheBackedUpCalendars()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var personal = Assert.Single(store.Calendars);
        Assert.Equal("Personal", personal.Name);
        var plan = Read(store, "restore/Thirteen calendars 2026-10-19.zip");
        var outcome = await ImportExport.RestoreAsync(store, plan.Sources);
        Assert.Equal((3, 0), (outcome.Calendars, outcome.KeptNewer));
        Assert.Equal(["ac8b5389-489e-422e-b633-807e74445762"], outcome.SubscriptionIds);
        Assert.Null(store.Find(personal.Id)); // the empty first-use Personal gave way
        var calendars = store.Calendars.ToDictionary(c => c.Id);
        Assert.Equal(3, calendars.Count);
        Assert.Equal(("Personal", "#ea580c", 4, false), Shape(calendars["0ab6ab60-378b-4c89-8a97-2770524d4fae"]));
        Assert.Equal(("Work", "#2563eb", 2, false), Shape(calendars["4074b90e-c55e-46db-882c-8096d5beef46"]));
        var holidays = calendars["ac8b5389-489e-422e-b633-807e74445762"];
        Assert.Equal(("Holidays in Estonia", "#57534e", 16, true), Shape(holidays));
        Assert.Equal(("https://calendar.example.com/holidays/ee.ics", "P1D"), (holidays.Record.Subscription!.Url, holidays.Record.Subscription.Interval));
        Assert.Equal(Bytes("restore/personal-restored.ics"), File.ReadAllBytes(store.DocumentPath("0ab6ab60-378b-4c89-8a97-2770524d4fae")));
        Assert.Equal("Restored 3 calendars.", ImportStrings.RestoreToast(outcome));

        // Restored again: still the same three, nothing newer, the subscription left as it is.
        var again = await ImportExport.RestoreAsync(store, Read(store, "restore/Thirteen calendars 2026-10-19.zip").Sources);
        Assert.Equal((3, 0), (again.Calendars, again.KeptNewer));
        Assert.Empty(again.SubscriptionIds);
        Assert.Equal(3, store.Calendars.Count);
        Assert.Equal(Bytes("restore/personal-restored-twice.ics"), File.ReadAllBytes(store.DocumentPath("0ab6ab60-378b-4c89-8a97-2770524d4fae")));
    }

    private static (string, string, int, bool) Shape(CalendarState c) => (c.Name, c.Color, c.EventCount, c.IsSubscription);

    [Fact]
    public async Task Restore_KeepsTheFirstUsePersonal_WhenItHoldsEvents()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var personal = store.Calendars[0];
        await StoreTesting.Put(store, personal.Id, StoreTesting.Timed("mine-1", "Mine", "2026-10-20T10:00", "2026-10-20T11:00"));
        await ImportExport.RestoreAsync(store, Read(store, "restore/Work.ics").Sources);
        Assert.Equal([personal.Id, "4074b90e-c55e-46db-882c-8096d5beef46"], store.Calendars.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task Restore_OlderExport_CountsTheEventKeptNewer()
    {
        using var folder = new TempFolder();
        File.WriteAllBytes(folder.File("0ab6ab60-378b-4c89-8a97-2770524d4fae.ics"), Bytes("restore/Personal.ics"));
        using var store = await Loaded(folder);
        var outcome = await ImportExport.RestoreAsync(store, Read(store, "restore/older.ics").Sources);
        Assert.Equal(1, outcome.KeptNewer);
        Assert.Equal("Restored 1 calendar. 1 event changed after this backup, so its newer version was kept.", ImportStrings.RestoreToast(outcome));
    }

    [Fact]
    public async Task Restore_IdOfASubscription_RestoresALocalCalendarUnderANewId()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        await ImportExport.RestoreAsync(store, Read(store, "restore/Holidays in Estonia.ics").Sources);
        // A local export that carries the subscription's id (edited by hand): a new local calendar, the feed untouched.
        var text = File.ReadAllText(RepoPaths.Fixture("ics", "restore", "Work.ics")).Replace("4074b90e-c55e-46db-882c-8096d5beef46", "ac8b5389-489e-422e-b633-807e74445762", StringComparison.Ordinal);
        var plan = ImportExport.ReadFiles([("Work.ics", Utf8.GetBytes(text))], store.Zones);
        var outcome = await ImportExport.RestoreAsync(store, plan.Sources);
        var id = Assert.Single(outcome.CalendarIds);
        Assert.NotEqual("ac8b5389-489e-422e-b633-807e74445762", id);
        Assert.Equal(("Work", false, 2), (store.Find(id)!.Name, store.Find(id)!.IsSubscription, store.Find(id)!.EventCount));
        Assert.True(store.Find("ac8b5389-489e-422e-b633-807e74445762")!.IsSubscription);
    }

    // ---- Export ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Export_OfARestoredCalendar_IsTheBackupAgain()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        await ImportExport.RestoreAsync(store, Read(store, "restore/Personal.ics").Sources);
        var text = ImportExport.ExportText(store, "0ab6ab60-378b-4c89-8a97-2770524d4fae", StoreTesting.At("2026-10-19T06:41"));
        Assert.Equal(Utf8.GetString(Bytes("restore/Personal.ics")), text);
    }

    [Fact]
    public async Task Export_OfASubscription_CarriesItsLinkAndInterval_AndARenamedCalendarItsNewName()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        await ImportExport.RestoreAsync(store, Read(store, "restore/Thirteen calendars 2026-10-19.zip").Sources);
        await store.UpdateRecordAsync("4074b90e-c55e-46db-882c-8096d5beef46", r => r with { Name = "Work; office", Color = "#16a34a" });
        var now = StoreTesting.At("2026-10-19T06:41");
        var holidays = ImportExport.ExportText(store, "ac8b5389-489e-422e-b633-807e74445762", now)!;
        Assert.Contains("\r\nX-THIRTEEN-CALENDAR-ID:ac8b5389-489e-422e-b633-807e74445762\r\n", holidays, StringComparison.Ordinal);
        Assert.Contains("\r\nX-THIRTEEN-SUBSCRIPTION-URL:https://calendar.example.com/holidays/ee.ics\r\n", holidays, StringComparison.Ordinal);
        Assert.Contains("\r\nX-THIRTEEN-SUBSCRIPTION-INTERVAL:P1D\r\n", holidays, StringComparison.Ordinal);
        var work = ImportExport.ExportText(store, "4074b90e-c55e-46db-882c-8096d5beef46", now)!;
        Assert.Contains("\r\nX-WR-CALNAME:Work\\; office\r\n", work, StringComparison.Ordinal);
        Assert.DoesNotContain("X-THIRTEEN-SUBSCRIPTION", work, StringComparison.Ordinal);
        var info = ImportExport.ReadFiles([("w.ics", Utf8.GetBytes(work))], store.Zones).Sources[0].Thirteen!;
        Assert.Equal(("Work; office", "#16a34a", false), (info.Name, info.Color, info.IsSubscription));
        Assert.Null(ImportExport.ExportText(store, "gone", now));
    }

    [Theory]
    [InlineData("Work", "Work")]
    [InlineData("Trips: 2027/Q1?", "Trips_ 2027_Q1_")]
    [InlineData("  ..Holidays.  ", "Holidays")]
    [InlineData("CON", "_CON")]
    [InlineData("com1.backup", "_com1.backup")]
    [InlineData("", "Calendar")]
    [InlineData("<>", "__")]
    public void FileNameOf_IsSafeOnWindows(string name, string expected) => Assert.Equal(expected, ImportExport.FileNameOf(name));

    [Fact]
    public async Task ExportToAFolder_GivesOneFilePerCalendar_NeverOverwrites_AndRestoresToTheSameCalendars()
    {
        using var folder = new TempFolder();
        using var target = new TempFolder();
        using var store = await Loaded(folder);
        await ImportExport.RestoreAsync(store, Read(store, "restore/Thirteen calendars 2026-10-19.zip").Sources);
        var second = await store.CreateCalendarAsync("Work", "#9333ea");
        await StoreTesting.Put(store, second.Id, StoreTesting.Timed("w2", "Standup", "2026-10-20T09:00", "2026-10-20T09:15"));
        File.WriteAllText(target.File("Personal.ics"), "not mine");
        var now = StoreTesting.At("2026-10-19T06:41");
        var ids = store.Calendars.Select(c => c.Id).ToArray();
        var written = await ImportExport.WriteFilesAsync(store, ids, target.Path, now);
        Assert.Equal(4, written.Count);
        Assert.Equal(["Holidays in Estonia.ics", "Personal (2).ics", "Work (2).ics", "Work.ics"], written.Select(p => Path.GetFileName(p)).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal("Personal (2).ics", Path.GetFileName(written[Array.IndexOf(ids, "0ab6ab60-378b-4c89-8a97-2770524d4fae")]));
        Assert.Equal("not mine", File.ReadAllText(target.File("Personal.ics")));
        Assert.All(written, path => Assert.NotEqual(0xEF, File.ReadAllBytes(path)[0]));

        // On another computer: the folder's files restore the same calendars, ids, names, colors and events.
        using var otherFolder = new TempFolder();
        using var other = await Loaded(otherFolder);
        var plan = await ImportExport.ReadPathsAsync(written, other.Zones);
        Assert.True(plan.IsRestore);
        var outcome = await ImportExport.RestoreAsync(other, plan.Sources);
        Assert.Equal(4, outcome.Calendars);
        Assert.Equal(
            store.Calendars.Select(c => (c.Id, c.Name, c.Color, c.EventCount, c.IsSubscription)).OrderBy(c => c.Id).ToArray(),
            other.Calendars.Select(c => (c.Id, c.Name, c.Color, c.EventCount, c.IsSubscription)).OrderBy(c => c.Id).ToArray());
    }

    [Fact]
    public async Task WriteOne_WritesTheCalendarToTheChosenStream()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        await ImportExport.RestoreAsync(store, Read(store, "restore/Work.ics").Sources);
        using var stream = new MemoryStream();
        stream.Write("old content that is longer than nothing"u8);
        Assert.True(await ImportExport.WriteOneAsync(store, "4074b90e-c55e-46db-882c-8096d5beef46", stream, StoreTesting.At("2026-10-19T06:41")));
        Assert.Equal(Bytes("restore/Work.ics"), stream.ToArray());
        Assert.Equal("Work.ics", ImportExport.SuggestedName("Work"));
    }

    // ---- The dialogs' view models ----------------------------------------------------------------------

    [Fact]
    public async Task ImportDialog_NamedFileGoesToANewCalendar_AnUnnamedOneToTheDefault()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var work = await store.CreateCalendarAsync("Work", "#2563eb");
        var unnamed = Utf8.GetBytes(File.ReadAllText(RepoPaths.Fixture("ics", "cases", "missing-uid.ics")).Replace("X-WR-CALNAME:Bookings\r\n", "", StringComparison.Ordinal));
        var plan = ImportExport.ReadFiles([("google-secret.ics", Bytes("cases/google-secret.ics")), ("dentist.ics", unnamed), ("notes.txt", "hello"u8.ToArray())], store.Zones);
        var dialog = new ImportDialogViewModel(store, plan, work.Id);
        Assert.Equal("Import events", dialog.Title);
        Assert.Equal("Import", dialog.SubmitText);
        var rows = dialog.Rows.OfType<ImportSourceRow>().ToArray();
        Assert.Equal(["google-secret.ics", "dentist.ics", "notes.txt"], dialog.Rows.OfType<ImportFileNameRow>().Select(r => r.Name).ToArray());
        Assert.Equal("This file isn't a calendar (.ics) file.", Assert.Single(dialog.Rows.OfType<ImportErrorRow>()).Text);
        Assert.Equal("New calendar: Liis Kask", rows[0].SelectedTarget.Label);
        Assert.Equal(work.Id, rows[1].SelectedTarget.CalendarId);
        Assert.Equal(["Personal", "Work", "New calendar: dentist"], rows[1].Targets.Select(t => t.Label).ToArray());
        Assert.Equal("3 events in google-secret.ics", rows[0].Summary);
        string? toast = null;
        dialog.Finished += t => toast = t;
        await dialog.ImportCommand.ExecuteAsync(null);
        Assert.Equal("Added 5, updated 0, unchanged 0.", toast);
        Assert.Equal(3, store.Calendars.Count);
        Assert.Equal(2, store.Find(work.Id)!.EventCount);
    }

    [Fact]
    public async Task RestoreDialog_RestoresTheCheckedCalendars()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        var plan = Read(store, "restore/Thirteen calendars 2026-10-19.zip");
        var dialog = new ImportDialogViewModel(store, plan);
        Assert.Equal(("Restore calendars", "Restore"), (dialog.Title, dialog.SubmitText));
        Assert.Equal("3 calendars in Thirteen calendars 2026-10-19.zip", Assert.Single(dialog.Rows.OfType<RestoreSummaryRow>()).Text);
        var rows = dialog.Rows.OfType<RestoreCalendarRow>().ToArray();
        Assert.Equal(["local · 4 events", "local · 2 events", "subscription"], rows.Select(r => r.Detail).ToArray());
        Assert.All(rows, r => Assert.True(r.IsChecked));
        foreach (var row in rows) row.IsChecked = false;
        Assert.False(dialog.ImportCommand.CanExecute(null));
        rows[1].IsChecked = true;
        Assert.True(dialog.ImportCommand.CanExecute(null));
        string? toast = null;
        dialog.Finished += t => toast = t;
        await dialog.ImportCommand.ExecuteAsync(null);
        Assert.Equal("Restored 1 calendar.", toast);
        Assert.Equal(["4074b90e-c55e-46db-882c-8096d5beef46"], store.Calendars.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task ExportDialog_ShowsTheSecretLinksNote_OnlyWithASubscriptionChecked()
    {
        using var folder = new TempFolder();
        using var store = await Loaded(folder);
        await ImportExport.RestoreAsync(store, Read(store, "restore/Thirteen calendars 2026-10-19.zip").Sources);
        var dialog = new ExportDialogViewModel(store, ["4074b90e-c55e-46db-882c-8096d5beef46"]);
        Assert.Equal(["4074b90e-c55e-46db-882c-8096d5beef46"], dialog.Chosen);
        Assert.False(dialog.ShowsSecretLinks);
        dialog.Calendars.Single(c => c.IsSubscription).IsChecked = true;
        Assert.True(dialog.ShowsSecretLinks);
        IReadOnlyList<string>? exported = null;
        dialog.Export = ids =>
        {
            exported = ids;
            return Task.FromResult(true);
        };
        var finished = false;
        dialog.Finished += written => finished = written;
        await dialog.ExportCommand.ExecuteAsync(null);
        Assert.True(finished);
        Assert.Equal(["4074b90e-c55e-46db-882c-8096d5beef46", "ac8b5389-489e-422e-b633-807e74445762"], exported);
        foreach (var c in dialog.Calendars) c.IsChecked = false;
        Assert.False(dialog.ExportCommand.CanExecute(null));
        Assert.DoesNotContain('–', dialog.SecretLinksText);
        Assert.DoesNotContain('—', dialog.SecretLinksText);
    }
}
