using System.Globalization;
using Thirteen.Core;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop;

/// <summary>
/// Command-line options. Besides the smoke checks (see <see cref="Program"/>), these open the app in a given
/// state for screenshots and QA, without touching the user's saved settings:
/// <code>
/// Thirteen.exe --page calendar --calendar-mode year --theme slate --mode dark --system positivist --date 2026-10-19
///              --select 2026-10-19 --year 2024 --width 1280 --height 860 --scroll bottom --maximized
/// Thirteen.exe --fake-events --route month/2026/11 --text-scale 1.5 --high-contrast desert
/// Thirteen.exe thirteen://year/2024?day=2024-06-17
/// </code>
/// <c>--page year</c> (the section before Calendar replaced it) opens Calendar in Year mode. <c>--fake-events</c> runs on
/// the mockup data set and fixes today to its day, 2026-10-19 (an IFC Thursday, October 12), unless <c>--date</c> says
/// otherwise. Any of <c>--page --theme --mode --system --date --select --year --scroll --calendar-mode --route
/// --text-scale --high-contrast</c> makes the run read-only:
/// settings.json is read but never written, even when its value is not understood. A value that is not
/// understood is reported on stderr and ignored; the run goes on with the saved setting.
/// </summary>
public sealed class LaunchOptions
{
    /// <summary>The screen to open: today, calendar, convert, compare, history, settings (<c>year</c> is Calendar in Year mode).</summary>
    public AppSection? Page { get; private init; }

    /// <summary><c>--calendar-mode day|week|month|year|list</c>: the Calendar mode to open (and <c>--page year</c>).</summary>
    public CalendarMode? CalendarMode { get; private init; }

    /// <summary><c>--route month/2026/11</c>: a route of §2.22 without its scheme, opened like a <c>thirteen://</c> link (QA, screenshots).</summary>
    public DeepLink? Route { get; private init; }

    /// <summary><c>--text-scale 1.5</c>: the Windows text scale for this run (150 % and above: Month's list of days).</summary>
    public double? TextScale { get; private init; }

    /// <summary>
    /// <c>--high-contrast [aquatic|desert|dusk|nightsky]</c>: a Windows contrast theme for this run (alone: Aquatic), in place
    /// of Windows' own setting (QA, screenshots, and the contrast checks on macOS; docs/EVENTS.md §2.20).
    /// </summary>
    public HighContrastColors? HighContrast { get; private init; }

    /// <summary>The colour theme for this run.</summary>
    public ThirteenTheme? Theme { get; private init; }

    /// <summary>Light, dark or system for this run.</summary>
    public AppearanceMode? Mode { get; private init; }

    /// <summary>The 13-month system for this run.</summary>
    public CalendarSystemId? System { get; private init; }

    /// <summary>Pretend today is this date (also used by --smoke).</summary>
    public GregorianDate? Today { get; private init; }

    /// <summary>Open the day details for this date (and Year on its year).</summary>
    public GregorianDate? Select { get; private init; }

    /// <summary>The year for Year and Compare.</summary>
    public int? Year { get; private init; }

    /// <summary>Window width in device-independent pixels.</summary>
    public double? Width { get; private init; }

    /// <summary>Window height in device-independent pixels.</summary>
    public double? Height { get; private init; }

    /// <summary>Start maximized.</summary>
    public bool Maximized { get; private init; }

    /// <summary>Where pages start scrolled: top, center or bottom.</summary>
    public string? Scroll { get; private init; }

    /// <summary>A thirteen:// link to open.</summary>
    public DeepLink? Link { get; private init; }

    /// <summary>
    /// Files to import (<c>Thirteen.exe "C:\path\file.ics"</c>, <c>--import &lt;path&gt;</c>) or a link to subscribe to
    /// (<c>webcal://</c>, <c>thirteen://subscribe?url=</c>), shown in their dialog (§6.4 "Command line").
    /// </summary>
    public ExternalRequest? External { get; private init; }

    /// <summary><c>--fake-events</c>: the mockup data set (fixtures/mockup/mockup-events.json) instead of the stored calendars (screenshots and QA).</summary>
    public bool FakeEvents { get; private init; }

    /// <summary>Whether this run must not write settings.</summary>
    public bool IsReadOnly { get; private init; }

    /// <summary>Problems with the arguments (reported on stderr, never fatal).</summary>
    public IReadOnlyList<string> Errors { get; private init; } = [];

    /// <summary>The switches that make a run read-only (screenshots and QA).</summary>
    public static IReadOnlyList<string> QaSwitches { get; } =
        ["--page", "--theme", "--mode", "--system", "--date", "--select", "--year", "--scroll", "--smoke-ui", "--fake-events", "--calendar-mode", "--route", "--text-scale",
         "--high-contrast"];

    /// <summary>The mockup data set's today (fixtures/mockup/mockup-events.json "now"): an IFC Thursday, October 12, 2026.</summary>
    public static GregorianDate MockupToday { get; } = new(2026, 10, 19);

    /// <summary>Parses the arguments; unknown switches are ignored.</summary>
    public static LaunchOptions Parse(IReadOnlyList<string> args)
    {
        var errors = new List<string>();
        string? Value(string name)
        {
            for (var i = 0; i < args.Count - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            }
            return null;
        }
        bool Has(string name) => args.Any(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));

        AppSection? page = null;
        CalendarMode? calendarMode = null;
        if (Value("--page") is { } pageText)
        {
            if (string.Equals(pageText, "year", StringComparison.OrdinalIgnoreCase))
            {
                page = AppSection.Calendar;
                calendarMode = ViewModels.CalendarMode.Year;
            }
            else
            {
                page = int.TryParse(pageText, out _) ? null : AppSections.FromId(pageText);
            }
            if (page is null) errors.Add($"--page: unknown page \"{pageText}\" (today, calendar, year, convert, compare, history, settings)");
        }
        if (Value("--calendar-mode") is { } modeId)
        {
            if (CalendarModes.FromId(modeId) is { } parsedMode) calendarMode = parsedMode;
            else errors.Add($"--calendar-mode: expected day, week, month, year or list, got \"{modeId}\"");
        }
        DeepLink? route = null;
        if (Value("--route") is { } routeText)
        {
            route = DeepLink.TryParse(DeepLink.Scheme + "://" + routeText.TrimStart('/'));
            if (route is null) errors.Add($"--route: not a Thirteen route \"{routeText}\" (calendar, year/2026, month/2026/11, week/2026-10-19, day/2026-10-19)");
        }
        double? textScale = null;
        if (Value("--text-scale") is { } scaleText)
        {
            if (double.TryParse(scaleText.TrimEnd('%'), NumberStyles.Float, CultureInfo.InvariantCulture, out var scale) && scale > 0)
            {
                textScale = scaleText.EndsWith('%') || scale >= 10 ? scale / 100 : scale;
            }
            else
            {
                errors.Add($"--text-scale: expected a scale such as 1.5 or 150%, got \"{scaleText}\"");
            }
        }
        HighContrastColors? highContrast = null;
        if (Has("--high-contrast"))
        {
            var contrastText = Value("--high-contrast");
            // A switch, a link or a file after it is not its value (Thirteen.exe --high-contrast C:\Users\me\file.ics).
            if (contrastText is null || contrastText.StartsWith("--", StringComparison.Ordinal) || contrastText.IndexOfAny([':', '.', '/', '\\']) >= 0)
            {
                highContrast = HighContrastColors.Aquatic;
            }
            else if (HighContrastColors.Presets.TryGetValue(contrastText.Replace(" ", "", StringComparison.Ordinal), out var preset))
            {
                highContrast = preset;
            }
            else
            {
                highContrast = HighContrastColors.Aquatic;
                errors.Add($"--high-contrast: expected aquatic, desert, dusk or nightsky, got \"{contrastText}\" (using aquatic)");
            }
        }
        ThirteenTheme? theme = null;
        if (Value("--theme") is { } themeText)
        {
            var id = themeText.Trim().ToLowerInvariant();
            if (ThemeTokens.Ordered.Any(t => t.Id() == id)) theme = ThemeTokens.FromId(id);
            else errors.Add($"--theme: unknown theme \"{themeText}\" ({string.Join(", ", ThemeTokens.Ordered.Select(t => t.Id()))})");
        }
        AppearanceMode? mode = null;
        if (Value("--mode") is { } modeText)
        {
            if (modeText.ToLowerInvariant() is "light" or "dark" or "system") mode = AppearanceModes.FromId(modeText);
            else errors.Add($"--mode: expected light, dark or system, got \"{modeText}\"");
        }
        CalendarSystemId? system = null;
        if (Value("--system") is { } systemText)
        {
            if (CalendarSystemIdExtensions.TryParse(systemText.ToLowerInvariant(), out var parsed)) system = parsed;
            else errors.Add($"--system: expected ifc or positivist, got \"{systemText}\"");
        }
        GregorianDate? Date(string name)
        {
            if (Value(name) is not { } text) return null;
            if (GregorianDate.TryParseIso(text, out var date)) return date;
            errors.Add($"{name}: expected an ISO date YYYY-MM-DD, got \"{text}\"");
            return null;
        }
        double? Size(string name)
        {
            if (Value(name) is not { } text) return null;
            if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && v > 0 && v < 100_000) return v;
            errors.Add($"{name}: expected a size in pixels, got \"{text}\"");
            return null;
        }
        int? year = null;
        if (Value("--year") is { } yearText)
        {
            if (int.TryParse(yearText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var y) && GregorianDate.IsValidYear(y)) year = y;
            else errors.Add($"--year: expected a year from 1 to 9999, got \"{yearText}\"");
        }
        var link = args.Select(DeepLink.TryParse).FirstOrDefault(l => l is not null);
        var scroll = Value("--scroll")?.ToLowerInvariant();
        if (scroll is not (null or "top" or "center" or "bottom")) errors.Add($"--scroll: expected top, center or bottom, got \"{Value("--scroll")}\"");
        if (args.FirstOrDefault(a => a.StartsWith(DeepLink.Scheme + ":", StringComparison.OrdinalIgnoreCase) && DeepLink.TryParse(a) is null
                && ExternalRequest.SubscribeLink(a) is null) is { } badLink)
        {
            errors.Add($"not a Thirteen link: \"{badLink}\" (thirteen://today, calendar, year/2026, month/2026/11, day/2026-10-19, convert?date=2026-10-19, compare/2026, history)");
        }

        var fakeEvents = Has("--fake-events");
        return new LaunchOptions
        {
            Page = page,
            CalendarMode = calendarMode,
            Route = route,
            TextScale = textScale,
            HighContrast = highContrast,
            Theme = theme,
            Mode = mode,
            System = system,
            // The mockup data set is about one day: a --fake-events run is on it unless --date says otherwise.
            Today = Date("--date") ?? (fakeEvents && Value("--date") is null ? MockupToday : null),
            Select = Date("--select"),
            Year = year,
            Width = Size("--width"),
            Height = Size("--height"),
            Maximized = Has("--maximized"),
            Scroll = scroll is "top" or "center" or "bottom" ? scroll : null,
            Link = link,
            External = ExternalRequest.Parse(args),
            FakeEvents = fakeEvents,
            Errors = errors,
            // A QA switch with a value that is not understood still marks a QA run: it must not write the
            // user's settings or join (and take over) the running instance.
            IsReadOnly = QaSwitches.Any(Has),
        };
    }
}
