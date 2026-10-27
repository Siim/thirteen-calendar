using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;

namespace Thirteen.Desktop.Services;

/// <summary>
/// One Thirteen window per user session. A second start (a Start menu click, a <c>thirteen://</c> link opened by
/// the browser, an <c>.ics</c> file opened with Thirteen, a <c>webcal://</c> link, <c>--import &lt;path&gt;</c>) hands
/// its arguments to the running instance over a local named pipe and exits (docs/EVENTS.md §6.4); the running
/// instance opens them and comes to the front. Local only: the pipe is per user and session, and nothing
/// listens on the network.
/// </summary>
public sealed class SingleInstance : IDisposable
{
    private const string ActivateMessage = "activate";
    private const string QuitMessage = "quit";
    private const string ArgumentsMessage = "args";
    private const int MaxArguments = 64;
    private readonly Mutex _mutex;
    private readonly string _pipeName;
    private readonly CancellationTokenSource _stop = new();
    private readonly Thread _listener;
    private NamedPipeServerStream? _firstServer;

    private SingleInstance(Mutex mutex, string pipeName)
    {
        _mutex = mutex;
        _pipeName = pipeName;
        // The first pipe exists before Start returns, so a second start right after this one finds it even when the
        // listener thread has not run yet (a busy machine); Listen takes it over.
        _firstServer = TryCreateServer();
        _listener = new Thread(Listen) { IsBackground = true, Name = "Thirteen single instance" };
        _listener.Start();
    }

    private NamedPipeServerStream? TryCreateServer()
    {
        try
        {
            return CreateServer();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"Thirteen: single-instance pipe: {e.Message}");
            return null;
        }
    }

    private NamedPipeServerStream CreateServer() =>
        new(_pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);

    /// <summary>A <c>thirteen://</c> link or an activation request (null) from a second start (raised on a background thread).</summary>
    public event Action<string?>? Received;

    /// <summary>
    /// The other arguments of a second start (raised on a background thread): files to import (full paths) and
    /// subscribe links (<c>webcal://</c>, <c>thirteen://subscribe?url=</c>); see <see cref="Support.ExternalRequest"/>.
    /// </summary>
    public event Action<IReadOnlyList<string>>? ArgumentsReceived;

    /// <summary><c>Thirteen.exe --quit</c> asks this instance to close (raised on a background thread).</summary>
    public event Action? QuitRequested;

    /// <summary>
    /// Becomes the instance of this session, or hands <paramref name="link"/> to the one already running.
    /// <paramref name="handedOver"/> is true when the running instance took over (this process should exit).
    /// Returns null when another instance exists: either it took over, or it did not answer and this
    /// process runs on its own so the user still gets a window.
    /// </summary>
    public static SingleInstance? Start(string? link, out bool handedOver) =>
        StartWith(link is null ? [] : [link], out handedOver);

    /// <summary>
    /// Becomes the instance of this session, or hands <paramref name="arguments"/> (from
    /// <see cref="Support.ExternalRequest.Forwarded"/>) to the one already running. See <see cref="Start(string?, out bool)"/>.
    /// </summary>
    public static SingleInstance? StartWith(IReadOnlyList<string> arguments, out bool handedOver)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        var name = SessionName();
        var mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        if (createdNew)
        {
            handedOver = false;
            return new SingleInstance(mutex, name);
        }
        mutex.Dispose();
        handedOver = TryHandOver(name, arguments.Count == 0 ? ActivateMessage : string.Join("\n", [ArgumentsMessage, .. arguments.Take(MaxArguments)]));
        return null;
    }

    /// <summary>
    /// <c>Thirteen.exe --quit</c>, run by the uninstaller and by setup before it replaces the files: asks the
    /// Thirteen of this session to close as if its window were closed (so it saves its settings), then waits
    /// for every other Thirteen started from this Thirteen.exe in this session to exit, and ends any still
    /// running after 10 seconds (a screenshot run, which does not listen). Without it, uninstalling while
    /// Thirteen was open left Thirteen.exe and its libraries behind. Always returns 0.
    /// </summary>
    public static int Quit()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        RequestQuit();
        using var self = Process.GetCurrentProcess();
        var path = Environment.ProcessPath;
        var deadline = DateTime.UtcNow.AddSeconds(10);
        foreach (var other in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(path) ?? "Thirteen"))
        {
            using (other)
            {
                if (other.Id == self.Id || other.SessionId != self.SessionId || !StartedFrom(other, path)) continue;
                var left = deadline - DateTime.UtcNow;
                if (other.WaitForExit(left > TimeSpan.Zero ? left : TimeSpan.Zero)) continue;
                try
                {
                    other.Kill();
                    other.WaitForExit(TimeSpan.FromSeconds(5));
                }
                catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception)
                {
                    Trace.WriteLine($"Thirteen: could not end process {other.Id}: {e.Message}");
                }
            }
        }
        return 0;
    }

    /// <summary>Asks the instance of this session, if there is one, to close. True when it got the request.</summary>
    internal static bool RequestQuit()
    {
        var name = SessionName();
        if (!Mutex.TryOpenExisting(MutexName, out var running)) return false;
        running.Dispose();
        return TryHandOver(name, QuitMessage);
    }

    private static bool StartedFrom(Process process, string? path)
    {
        try
        {
            return path is not null && string.Equals(process.MainModule?.FileName, path, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
        {
            return false;
        }
    }

    /// <summary>
    /// The instance's mutex (docs/EVENTS.md §6.4). <c>Local\</c> objects belong to one Windows session, so the name
    /// needs neither the user nor the session; named pipes are machine-wide, so <see cref="SessionName"/> names the pipe.
    /// </summary>
    internal const string MutexName = @"Local\HaugasDevelopment.Thirteen";

    /// <summary>The pipe name of this user and session.</summary>
    private static string SessionName()
    {
        using var self = Process.GetCurrentProcess();
        return "Thirteen-" + Sanitize(Environment.UserName) + "-" + self.SessionId.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    private static bool TryHandOver(string pipeName, string message)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out);
            client.Connect(1500);
            // Lets the running instance bring its window to the front (Windows only allows that to the
            // process the user just started, which is this one).
            if (OperatingSystem.IsWindows() && message != QuitMessage) AllowSetForegroundWindow(AsfwAny);
            var bytes = Encoding.UTF8.GetBytes(message + "\n");
            client.Write(bytes, 0, bytes.Length);
            client.Flush();
            return true;
        }
        catch (Exception e) when (e is IOException or TimeoutException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"Thirteen: could not reach the running instance: {e.Message}");
            return false;
        }
    }

    private void Listen()
    {
        while (!_stop.IsCancellationRequested)
        {
            try
            {
                using var server = Interlocked.Exchange(ref _firstServer, null) ?? CreateServer();
                server.WaitForConnectionAsync(_stop.Token).GetAwaiter().GetResult();
                using var reader = new StreamReader(server, Encoding.UTF8);
                var lines = new List<string>();
                while (lines.Count <= MaxArguments && reader.ReadLine() is { } read)
                {
                    if (read.Trim() is { Length: > 0 and < 2048 } line) lines.Add(line);
                }
                Dispatch(lines);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                Trace.WriteLine($"Thirteen: single-instance pipe: {e.Message}");
                if (_stop.Token.WaitHandle.WaitOne(200)) return;
            }
        }
    }

    /// <summary>One message: quit, activate, a legacy single link, or "args" and one argument per line.</summary>
    private void Dispatch(IReadOnlyList<string> lines)
    {
        if (lines.Count == 0) return;
        if (lines[0] == QuitMessage)
        {
            QuitRequested?.Invoke();
            return;
        }
        if (lines[0] != ArgumentsMessage)
        {
            Received?.Invoke(lines[0] == ActivateMessage ? null : lines[0]);
            return;
        }
        var arguments = lines.Skip(1).Take(MaxArguments).ToList();
        var links = arguments.Where(a => Support.DeepLink.TryParse(a) is not null).ToList();
        var others = arguments.Except(links).ToList();
        if (others.Count > 0) ArgumentsReceived?.Invoke(others);
        if (links.Count > 0) Received?.Invoke(links[0]);
        else if (others.Count == 0) Received?.Invoke(null);
    }

    private static string Sanitize(string text) =>
        new(text.Select(c => char.IsAsciiLetterOrDigit(c) ? c : '_').Take(40).ToArray());

    /// <inheritdoc />
    public void Dispose()
    {
        if (_stop.IsCancellationRequested) return;
        _stop.Cancel();
        Interlocked.Exchange(ref _firstServer, null)?.Dispose();
        // The pipe is closed when Dispose returns, so a next instance in this process (the tests) never meets it.
        if (Thread.CurrentThread != _listener) _listener.Join(TimeSpan.FromSeconds(2));
        try
        {
            _mutex.ReleaseMutex();
        }
        catch (ApplicationException)
        {
            // Released already or owned by another thread at shutdown.
        }
        _mutex.Dispose();
    }

    private const int AsfwAny = -1;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(int processId);
}
