using System.Text;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>Paths of the repository (fixtures are read from it, never copied).</summary>
internal static class RepoPaths
{
    private static readonly Lazy<string> Root = new(() =>
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "fixtures", "ics")) && Directory.Exists(Path.Combine(directory.FullName, "windows")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }
        throw new InvalidOperationException("The repository root (with fixtures/ics) was not found above " + AppContext.BaseDirectory);
    });

    public static string RepositoryRoot => Root.Value;

    public static string Fixture(params string[] parts) => Path.Combine([RepositoryRoot, "fixtures", .. parts]);

    public static string ReadFixture(params string[] parts) => File.ReadAllText(Fixture(parts), Encoding.UTF8);
}

/// <summary>A temporary Calendars folder, deleted afterwards.</summary>
internal sealed class TempFolder : IDisposable
{
    public TempFolder()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "thirteen-store-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // A watcher may still hold the folder for a moment; the OS cleans the temp folder.
        }
    }
}

/// <summary>Events and stores for tests.</summary>
internal static class StoreTesting
{
    public const string Tallinn = "Europe/Tallinn";

    /// <summary>2026-10-19T06:41Z, the "now" of the ics fixtures and the mockup data set.</summary>
    public static readonly DateTimeOffset Now = new(2026, 10, 19, 6, 41, 0, TimeSpan.Zero);

    public static EventStore Store(TempFolder folder, FixedTimeProvider? time = null, bool readOnly = false) =>
        new(folder.Path, WindowsZoneResolver.Shared, () => Tallinn, time ?? new FixedTimeProvider(Now), readOnly)
        {
            WatchDelay = TimeSpan.FromMilliseconds(150),
        };

    public static LocalDateTime At(string text) => LocalDateTime.Parse(text);

    /// <summary>A timed single event in Tallinn.</summary>
    public static IcsEvent Timed(string uid, string summary, string start, string end, int sequence = 0) => new()
    {
        Uid = uid,
        Summary = summary,
        Start = new IcsDateValue.ZonedValue(At(start), Tallinn),
        End = new IcsDateValue.ZonedValue(At(end), Tallinn),
        Sequence = sequence,
        Dtstamp = new IcsDateValue.UtcValue(At("2026-10-01T09:00")),
    };

    /// <summary>An all-day event from <paramref name="first"/> through <paramref name="last"/>.</summary>
    public static IcsEvent AllDay(string uid, string summary, string first, string last)
    {
        var from = GregorianDate.ParseIso(first);
        var to = GregorianDate.ParseIso(last);
        var end = IcsGroups.AllDayEnd(from, to);
        return new IcsEvent
        {
            Uid = uid,
            Summary = summary,
            Start = new IcsDateValue.DateValue(from),
            End = end.End,
            Duration = end.Duration,
            Dtstamp = new IcsDateValue.UtcValue(At("2026-10-01T09:00")),
        };
    }

    public static IcsGroup Group(IcsEvent master) => new(master.Uid, master, ValueList<IcsEvent>.Empty);

    /// <summary>Adds (or replaces) a single event in a calendar.</summary>
    public static Task<IcsCalendar> Put(IEventStore store, string calendarId, IcsEvent e) =>
        store.UpdateGroupAsync(calendarId, e.Uid, (_, _) => Group(e));

    /// <summary>The text of every VEVENT and VTIMEZONE of a document, keyed by UID (+ RECURRENCE-ID) or TZID.</summary>
    public static Dictionary<string, string> Components(string text)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var lines = text.Split("\r\n");
        for (var i = 0; i < lines.Length; i++)
        {
            if (lines[i] is not ("BEGIN:VEVENT" or "BEGIN:VTIMEZONE")) continue;
            var kind = lines[i][6..];
            var end = Array.IndexOf(lines, "END:" + kind, i);
            var block = string.Join("\r\n", lines[i..(end + 1)]);
            var id = lines[i..end].FirstOrDefault(l => l.StartsWith(kind == "VEVENT" ? "UID" : "TZID", StringComparison.Ordinal)) ?? "";
            var recurrence = lines[i..end].FirstOrDefault(l => l.StartsWith("RECURRENCE-ID", StringComparison.Ordinal)) ?? "";
            result[kind + "|" + id + "|" + recurrence] = block;
            i = end;
        }
        return result;
    }

    /// <summary>Waits until a condition holds (polling), or fails after the timeout.</summary>
    public static async Task Eventually(Func<bool> condition, string what, int milliseconds = 8000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(50);
        }
        Assert.Fail($"Timed out waiting for: {what}");
    }
}
