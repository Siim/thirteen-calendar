using System.Reflection;
using System.Runtime.InteropServices;
using Thirteen.Core;

namespace Thirteen.Desktop;

/// <summary>
/// Command-line smoke checks. Thirteen.exe is a GUI-subsystem program, so when it is started from an
/// interactive console without redirection it has no stdout; <see cref="EnsureStdout"/> attaches to the
/// parent console in that case. Redirected or piped output (ssh, CI, <c>| more</c>) works as is.
/// </summary>
internal static class SmokeCommand
{
    /// <summary>Set by <c>--smoke-ui</c>: App closes the window and exits once it has rendered.</summary>
    public static bool UiSmokeRequested { get; set; }

    /// <summary>Set by <c>--screenshot file.png</c> together with <c>--smoke-ui</c>.</summary>
    public static string? ScreenshotPath { get; set; }

    /// <summary>
    /// <c>--smoke [--date YYYY-MM-DD]</c>: prints today's IFC date (first line) plus context and exits 0;
    /// <c>--date</c> describes that day instead of today (exit 2 if it is not a valid ISO date).
    /// </summary>
    public static int Run(string? date = null)
    {
        EnsureStdout();
        var day = GregorianDate.Today();
        if (date is not null && !GregorianDate.TryParseIso(date, out day))
        {
            Console.Error.WriteLine($"--date expects an ISO date YYYY-MM-DD in 0001-01-01..9999-12-31, got \"{date}\"");
            return 2;
        }
        foreach (var line in Describe(day)) Console.Out.WriteLine(line);
        Console.Out.Flush();
        return 0;
    }

    /// <summary>The smoke report for a date. The first line is the IFC date.</summary>
    public static IEnumerable<string> Describe(GregorianDate today)
    {
        var ifc = today.ToThirteen(CalendarSystemId.Ifc);
        var positivist = today.ToThirteen(CalendarSystemId.Positivist);
        var withWeekday = new FormatOptions(IncludeWeekday: true);
        yield return $"Today (IFC):  {ifc.Format(withWeekday)} [{ifc.Format(FormatOptions.Numeric)}]";
        yield return $"Gregorian:    {today.Format(withWeekday)} [{today.ToIsoString()}]";
        yield return $"Positivist:   {positivist.Format(withWeekday)}";
        var until = today.DaysUntilYearDay();
        yield return $"Year Day in:  {until} {(until == 1 ? "day" : "days")}";
        yield return $"{Product()} {Version()} on {RuntimeInformation.OSDescription.Trim()}, " +
            $"process {RuntimeInformation.ProcessArchitecture}, OS {RuntimeInformation.OSArchitecture}, " +
            $"runtime {RuntimeInformation.RuntimeIdentifier}, {RuntimeInformation.FrameworkDescription}";
    }

    internal static string Product() =>
        typeof(SmokeCommand).Assembly.GetCustomAttribute<AssemblyProductAttribute>()?.Product ?? "Thirteen";

    internal static string Version()
    {
        var info = typeof(SmokeCommand).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";
        var plus = info.IndexOf('+', StringComparison.Ordinal);
        return plus < 0 ? info : info[..plus];
    }

    /// <summary>Gives a GUI-subsystem process a stdout when it was started from a console without redirection.</summary>
    public static void EnsureStdout()
    {
        if (!OperatingSystem.IsWindows()) return;
        var handle = GetStdHandle(StdOutputHandle);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) AttachConsole(AttachParentProcess);
    }

    private const int StdOutputHandle = -11;
    private const uint AttachParentProcess = 0xFFFFFFFF;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachConsole(uint dwProcessId);
}
