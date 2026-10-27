using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests;

/// <summary>One instance per session: a second start hands over its link, and --quit closes the first.</summary>
[Collection(nameof(ProcessWideCollection))]
public class SingleInstanceTests
{
    [Fact]
    public void ASecondStartHandsOverAndQuitAsksTheFirstToClose()
    {
        using var first = SingleInstance.Start(null, out var handedOver);
        Assert.NotNull(first);
        Assert.False(handedOver);
        // The session's mutex has the name of docs/EVENTS.md §6.4.
        Assert.True(Mutex.TryOpenExisting(@"Local\HaugasDevelopment.Thirteen", out var mutex));
        mutex.Dispose();
        var links = new List<string?>();
        using var quit = new ManualResetEventSlim();
        using var linked = new ManualResetEventSlim();
        first.Received += link =>
        {
            lock (links) links.Add(link);
            linked.Set();
        };
        first.QuitRequested += quit.Set;

        Assert.Null(SingleInstance.Start("thirteen://year/2024", out var second));
        Assert.True(second);
        Assert.True(linked.Wait(TimeSpan.FromSeconds(5)));
        lock (links) Assert.Equal(["thirteen://year/2024"], links);
        Assert.False(quit.IsSet);

        Assert.True(SingleInstance.RequestQuit());
        Assert.True(quit.Wait(TimeSpan.FromSeconds(5)));
        lock (links) Assert.Single(links);          // "quit" is not a link
    }

    [Fact]
    public void QuitWithNothingRunningDoesNothing() => Assert.False(SingleInstance.RequestQuit());
}
