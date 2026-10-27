using System.Runtime.InteropServices;
using Avalonia.Media;
using Avalonia.Platform;

namespace Thirteen.Desktop.Themes;

/// <summary>
/// The system colours of a Windows contrast theme (Settings, Accessibility, Contrast themes), named as CSS names them for
/// forced colors: <c>Canvas</c> (<c>COLOR_WINDOW</c>), <c>CanvasText</c> (<c>COLOR_WINDOWTEXT</c>), <c>Highlight</c> and
/// <c>HighlightText</c> (selected text), <c>LinkText</c> (<c>COLOR_HOTLIGHT</c>), <c>GrayText</c> (inactive text),
/// <c>ButtonFace</c> and <c>ButtonText</c>.
/// <para>
/// While a contrast theme is on (Avalonia's <c>PlatformColorValues.ContrastPreference == High</c>; docs/EVENTS.md §2.20
/// "Forced colors and high contrast", §6.4 "Text size and contrast") Thirteen paints with these colours instead of its own
/// theme (<see cref="ToPalette"/>), and the Calendar's drawn chips, bars, blocks and dots follow the web's forced-colors
/// rules: chips and bars get a 1 px <c>CanvasText</c> border and no tint, the tentative hatch becomes a dashed border, dots
/// get a <c>CanvasText</c> ring, and the now line and today use <c>Highlight</c> and <c>HighlightText</c>.
/// </para>
/// </summary>
/// <param name="Name">The contrast theme's name ("Aquatic"), or "Windows" for colours read from the system.</param>
/// <param name="Canvas">Background.</param>
/// <param name="CanvasText">Text and borders on <paramref name="Canvas"/>.</param>
/// <param name="Highlight">Selected background (also the now line and today).</param>
/// <param name="HighlightText">Text on <paramref name="Highlight"/>.</param>
/// <param name="LinkText">Hyperlinks.</param>
/// <param name="GrayText">Inactive (disabled) text.</param>
/// <param name="ButtonFace">Button background.</param>
/// <param name="ButtonText">Button text.</param>
public sealed record HighContrastColors(
    string Name,
    Color Canvas,
    Color CanvasText,
    Color Highlight,
    Color HighlightText,
    Color LinkText,
    Color GrayText,
    Color ButtonFace,
    Color ButtonText)
{
    // The four contrast themes of Windows 11 with their default colours (Settings, Accessibility, Contrast themes, Edit).
    // They stand in for the system on macOS and in the tests (--high-contrast <name>); on Windows the real colours are read.

    /// <summary>Aquatic, the default contrast theme of Windows 11 (dark).</summary>
    public static HighContrastColors Aquatic { get; } = new("Aquatic",
        Rgb(0x202020), Rgb(0xFFFFFF), Rgb(0x8EE3F0), Rgb(0x263B50), Rgb(0x75E9FC), Rgb(0xA6A6A6), Rgb(0x202020), Rgb(0xFFFFFF));

    /// <summary>Desert, the light contrast theme of Windows 11.</summary>
    public static HighContrastColors Desert { get; } = new("Desert",
        Rgb(0xFFFAEF), Rgb(0x3D3D3D), Rgb(0x903909), Rgb(0xFFF5E3), Rgb(0x1C5E75), Rgb(0x676767), Rgb(0xFFFAEF), Rgb(0x202020));

    /// <summary>Dusk (dark).</summary>
    public static HighContrastColors Dusk { get; } = new("Dusk",
        Rgb(0x2D3236), Rgb(0xB6F6F0), Rgb(0xA1BFDE), Rgb(0x212D3B), Rgb(0x70EBDE), Rgb(0xA6A6A6), Rgb(0x2D3236), Rgb(0xB6F6F0));

    /// <summary>Night sky (dark, black background).</summary>
    public static HighContrastColors NightSky { get; } = new("Night sky",
        Rgb(0x000000), Rgb(0xFFFFFF), Rgb(0xD6B4FD), Rgb(0x2B2B2B), Rgb(0x8080FF), Rgb(0xA6A6A6), Rgb(0x000000), Rgb(0xFFEE32));

    /// <summary>The four contrast themes by their <c>--high-contrast</c> ids.</summary>
    public static IReadOnlyDictionary<string, HighContrastColors> Presets { get; } = new Dictionary<string, HighContrastColors>(StringComparer.OrdinalIgnoreCase)
    {
        ["aquatic"] = Aquatic,
        ["desert"] = Desert,
        ["dusk"] = Dusk,
        ["nightsky"] = NightSky,
    };

    /// <summary>Whether the background is dark (the app then runs in the Dark variant, so Fluent's own parts match).</summary>
    public bool IsDark => ThemeResources.Luminance(Canvas) < ThemeResources.Luminance(CanvasText);

    /// <summary>
    /// The theme roles in this contrast theme: every paper is <c>Canvas</c>; text, rules and the Gregorian foil are
    /// <c>CanvasText</c> (faint dividers <c>GrayText</c>); the accent is <c>Highlight</c> with <c>HighlightText</c> on it,
    /// accent text is <c>LinkText</c>; no shadows. Selected and hover washes are <c>Highlight</c> mixed into
    /// <c>Canvas</c> (22 % and 16 %), so <c>CanvasText</c> stays readable on them in every contrast theme.
    /// </summary>
    public ThemePalette ToPalette() => new()
    {
        Paper = Canvas,
        PaperRaised = Canvas,
        PaperSunk = Canvas,
        Ink = CanvasText,
        InkSecondary = CanvasText,
        InkTertiary = CanvasText,
        Rule = CanvasText,
        RuleSoft = GrayText,
        RuleStrong = CanvasText,
        Accent = Highlight,
        AccentText = LinkText,
        AccentWash = ThemeResources.Mix(Canvas, Highlight, 0.22),
        AccentSoft = ThemeResources.Mix(Canvas, Highlight, 0.16),
        OnAccent = HighlightText,
        ControlTint = Highlight,
        Foil = CanvasText,
        FoilWash = Canvas,
        FoilSoft = ThemeResources.Mix(Canvas, CanvasText, 0.16),
        OnFoil = Canvas,
        Focus = CanvasText,
        Scrim = ThemeResources.WithAlpha(Canvas, 0.7),
        Grain = Colors.Transparent,
        Shadow = Colors.Transparent,
    };

    /// <summary>
    /// Whether the platform reports a contrast theme (Avalonia's <see cref="PlatformColorValues.ContrastPreference"/>). Only
    /// Windows is followed: there the colours can be read (<see cref="ReadSystem"/>); macOS "Increase contrast" keeps the
    /// app's theme, as the Apple apps' own rules for it are not this one (§2.20).
    /// </summary>
    public static bool IsRequested(PlatformColorValues? values) =>
        OperatingSystem.IsWindows() && values?.ContrastPreference == ColorContrastPreference.High;

    /// <summary>The contrast theme's colours from Windows (<c>GetSysColor</c>), or null elsewhere or when they cannot be read.</summary>
    public static HighContrastColors? ReadSystem()
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            return new HighContrastColors("Windows",
                SysColor(ColorWindow), SysColor(ColorWindowText), SysColor(ColorHighlight), SysColor(ColorHighlightText),
                SysColor(ColorHotLight), SysColor(ColorGrayText), SysColor(ColorButtonFace), SysColor(ColorButtonText));
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
        {
            return null;
        }
    }

    private const int ColorWindow = 5;
    private const int ColorWindowText = 8;
    private const int ColorHighlight = 13;
    private const int ColorHighlightText = 14;
    private const int ColorButtonFace = 15;
    private const int ColorGrayText = 17;
    private const int ColorButtonText = 18;
    private const int ColorHotLight = 26;

    // Plain DllImport (as Services/ScreenReader.cs): a blittable int in and out, no generated marshalling, no unsafe code.
    [DllImport("user32.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern uint GetSysColor(int index);

    /// <summary>A COLORREF (0x00BBGGRR) as an opaque colour.</summary>
    private static Color SysColor(int index)
    {
        var value = GetSysColor(index);
        return Color.FromRgb((byte)(value & 0xFF), (byte)((value >> 8) & 0xFF), (byte)((value >> 16) & 0xFF));
    }

    private static Color Rgb(uint rgb) => Color.FromRgb((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
}
