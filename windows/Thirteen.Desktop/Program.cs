using System.Globalization;
using System.Runtime.CompilerServices;
using Avalonia;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop;

internal static class Program
{
    /// <summary>The parsed command line of this run.</summary>
    public static LaunchOptions Options { get; private set; } = LaunchOptions.Parse([]);

    /// <summary>This session's single instance (null for QA runs and when another instance did not answer).</summary>
    public static SingleInstance? Instance { get; private set; }

    /// <summary>
    /// Entry point. Command-line switches:
    /// <c>--smoke</c> prints today's dates to stdout and exits 0 without creating a window (used by
    /// build-windows.sh to prove a published build runs on Windows; <c>--date YYYY-MM-DD</c> describes
    /// another day);
    /// <c>--smoke-ui</c> starts the real app, waits until the main window has opened and rendered, prints
    /// what it shows and exits 0 (or 1 after 30 seconds); add <c>--screenshot file.png</c> to also save
    /// the rendered window as a PNG;
    /// <c>--quit</c> closes the Thirteen running in this session and waits until it has exited (the installer
    /// and the uninstaller run it, so no file is in use);
    /// <c>--clear-alerts</c> removes every toast Thirteen scheduled and exits (the uninstaller runs it).
    /// Screenshot and QA options (<c>--page --theme --mode --system --date --select --year --width --height
    /// --scroll --maximized</c>) and <c>thirteen://</c> links are described in <see cref="LaunchOptions"/>.
    /// </summary>
    [STAThread]
    public static int Main(string[] args)
    {
        if (HasSwitch(args, "--smoke")) return SmokeCommand.Run(ValueOf(args, "--date"));
        if (HasSwitch(args, "--quit")) return SingleInstance.Quit();
        if (HasSwitch(args, "--clear-alerts")) return ToastPlatform.ClearAlertsCommand();
        if (HasSwitch(args, "--smoke-ui")) SmokeCommand.UiSmokeRequested = true;
        if (ValueOf(args, "--screenshot") is { } screenshot) SmokeCommand.ScreenshotPath = Path.GetFullPath(screenshot);
        Options = LaunchOptions.Parse(args);
        foreach (var error in Options.Errors)
        {
            SmokeCommand.EnsureStdout();
            Console.Error.WriteLine(error);
        }
        // Event times follow the OS 12 or 24-hour setting (docs/EVENTS.md §2.19), read before the culture is fixed.
        Support.EventStrings.Use24Hour = Support.EventStrings.Is24Hour(CultureInfo.CurrentCulture);
        // The app is English (SPEC 3.1): month and weekday names in the date pickers match the rest of the text.
        var english = CultureInfo.GetCultureInfo("en-US");
        CultureInfo.DefaultThreadCurrentCulture = english;
        CultureInfo.DefaultThreadCurrentUICulture = english;
        CultureInfo.CurrentCulture = english;
        CultureInfo.CurrentUICulture = english;
        // THIRTEEN_TRACE=1 copies Avalonia's warnings (binding and layout problems) to stderr.
        if (Environment.GetEnvironmentVariable("THIRTEEN_TRACE") == "1")
        {
            System.Diagnostics.Trace.Listeners.Add(new System.Diagnostics.TextWriterTraceListener(Console.Error));
            System.Diagnostics.Trace.AutoFlush = true;
        }
        // The process carries the app user model id of its Start menu entry and its alert toasts (§6.4), so the taskbar
        // groups the window with the entry and the toasts it schedules belong to it.
        ToastPlatform.SetProcessAppUserModelId();
        // One window per session: a second start hands its thirteen:// link (or just "come to the front")
        // to the running instance. QA and smoke runs always get their own process.
        if (OperatingSystem.IsWindows() && !Options.IsReadOnly && !SmokeCommand.UiSmokeRequested)
        {
            // Its thirteen:// link, webcal:// link or files to import (full paths) go to the running instance.
            Instance = SingleInstance.StartWith(Support.ExternalRequest.Forwarded(args), out var handedOver);
            if (handedOver) return 0;
        }
        try
        {
            return RunApp(args);
        }
        finally
        {
            Instance?.Dispose();
        }
    }

    private static bool HasSwitch(string[] args, string name) => args.Any(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>The argument after <paramref name="name"/>, or null when the switch or its value is missing.</summary>
    private static string? ValueOf(string[] args, string name)
    {
        var i = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    // Kept out of Main so the --smoke path never initialises Avalonia or loads its native libraries.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int RunApp(string[] args) => BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);

    /// <summary>Avalonia configuration; also used by the XAML previewer and the UI tests.</summary>
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .LogToTrace(Avalonia.Logging.LogEventLevel.Warning);
}
