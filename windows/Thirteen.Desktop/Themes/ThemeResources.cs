using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;

namespace Thirteen.Desktop.Themes;

/// <summary>
/// Turns a <see cref="ThirteenTheme"/> (generated from design/tokens.json into ThemeTokens.cs) into Avalonia
/// resources: one dictionary per theme with a light (<see cref="ThemeVariant.Default"/> and
/// <see cref="ThemeVariant.Light"/>) and a dark theme dictionary, so light and dark follow the
/// application's <c>ActualThemeVariant</c> and a theme switch only replaces one merged dictionary.
/// <para>
/// Views use the <c>Th*</c> keys (<c>ThPaper</c>, <c>ThInk</c>, <c>ThAccent</c>, ...) with
/// <c>DynamicResource</c>. The same dictionary also redefines the Fluent theme's accent colours and the
/// control brushes the app shows (text boxes, combo boxes, calendars, toggle switches, radio buttons,
/// tooltips, flyouts, scroll bars, focus rings), so built-in controls change with the theme at run time.
/// <see cref="ApplyFluentPalettes"/> also sets the Fluent palettes, which colour everything else.
/// </para>
/// </summary>
public static class ThemeResources
{
    /// <summary>Every role key, in token order: <c>ThPaper</c> ... <c>ThShadow</c> (brushes) plus <c>...Color</c> colours.</summary>
    public static IReadOnlyList<string> RoleKeys { get; } =
    [
        "ThPaper", "ThPaperRaised", "ThPaperSunk", "ThInk", "ThInk2", "ThInk3", "ThRule", "ThRuleSoft", "ThRuleStrong",
        "ThAccent", "ThAccentText", "ThAccentWash", "ThAccentSoft", "ThOnAccent", "ThControlTint", "ThFoil",
        "ThFoilWash", "ThFoilSoft", "ThOnFoil", "ThFocus", "ThScrim", "ThShadow",
    ];

    /// <summary>Marks a theme dictionary (its value is the theme id), so the service can find and replace it.</summary>
    public const string ThemeIdKey = "ThirteenThemeId";

    /// <summary>The resource dictionary of a theme, light and dark.</summary>
    public static ResourceDictionary Build(ThirteenTheme theme)
    {
        var dictionary = new ResourceDictionary { [ThemeIdKey] = theme.Id() };
        // An always-dark theme has one palette; its light dictionaries are dark too (the service also forces Dark).
        var lightIsDark = theme.IsAlwaysDark();
        dictionary.ThemeDictionaries[ThemeVariant.Default] = BuildMode(theme.Palette(dark: false), dark: lightIsDark);
        dictionary.ThemeDictionaries[ThemeVariant.Light] = BuildMode(theme.Palette(dark: false), dark: lightIsDark);
        dictionary.ThemeDictionaries[ThemeVariant.Dark] = BuildMode(theme.Palette(dark: true), dark: true);
        return dictionary;
    }

    /// <summary>
    /// The resource dictionary of a Windows contrast theme (docs/EVENTS.md §2.20): every variant gets the system colours of
    /// <paramref name="colors"/> (<see cref="HighContrastColors.ToPalette"/>), whatever the user's theme and appearance.
    /// Marked with the theme id plus ":contrast", so the service replaces it like any theme dictionary.
    /// </summary>
    public static ResourceDictionary Build(ThirteenTheme theme, HighContrastColors colors)
    {
        ArgumentNullException.ThrowIfNull(colors);
        var dictionary = new ResourceDictionary { [ThemeIdKey] = theme.Id() + ":contrast" };
        var palette = colors.ToPalette();
        foreach (var variant in new[] { ThemeVariant.Default, ThemeVariant.Light, ThemeVariant.Dark })
        {
            dictionary.ThemeDictionaries[variant] = BuildMode(palette, colors.IsDark, colors);
        }
        return dictionary;
    }

    /// <summary>
    /// The resources of one palette (one theme in one mode). With <paramref name="contrast"/> (a Windows contrast theme,
    /// §2.20) <c>ThHighContrast</c> is true, so the Calendar's drawn chips, bars, blocks and dots switch to their
    /// forced-colors look, <c>ThDotRingColor</c> rings every event dot in <c>CanvasText</c>, and <c>ThSelectedRing</c>
    /// is the 2 px <c>Highlight</c> ring inside a selected day (the web's outline; transparent otherwise).
    /// </summary>
    public static ResourceDictionary BuildMode(ThemePalette p, bool dark, HighContrastColors? contrast = null)
    {
        var d = new ResourceDictionary();
        d["ThHighContrast"] = contrast is not null;
        d["ThDotRingColor"] = contrast?.CanvasText ?? Colors.Transparent;
        d["ThSelectedRing"] = new SolidColorBrush(contrast?.Highlight ?? Colors.Transparent);

        void Role(string key, Color color)
        {
            d[key] = new SolidColorBrush(color);
            d[key + "Color"] = color;
        }

        Role("ThPaper", p.Paper);
        Role("ThPaperRaised", p.PaperRaised);
        Role("ThPaperSunk", p.PaperSunk);
        Role("ThInk", p.Ink);
        Role("ThInk2", p.InkSecondary);
        Role("ThInk3", p.InkTertiary);
        Role("ThRule", p.Rule);
        Role("ThRuleSoft", p.RuleSoft);
        Role("ThRuleStrong", p.RuleStrong);
        Role("ThAccent", p.Accent);
        Role("ThAccentText", p.AccentText);
        Role("ThAccentWash", p.AccentWash);
        Role("ThAccentSoft", p.AccentSoft);
        Role("ThOnAccent", p.OnAccent);
        Role("ThControlTint", p.ControlTint);
        Role("ThFoil", p.Foil);
        Role("ThFoilWash", p.FoilWash);
        Role("ThFoilSoft", p.FoilSoft);
        Role("ThOnFoil", p.OnFoil);
        Role("ThFocus", p.Focus);
        Role("ThScrim", p.Scrim);
        Role("ThShadow", p.Shadow);

        // Derived fills used by grids and charts (translucent over a card, like the Apple apps).
        var onControlTint = OnColor(p.ControlTint, p);
        Role("ThOnControlTint", onControlTint);
        Role("ThCell", WithAlpha(p.PaperSunk, 0.75));
        Role("ThCellHover", Mix(p.PaperSunk, p.Ink, 0.08));
        Role("ThWell", WithAlpha(p.PaperSunk, 0.6));
        Role("ThAccentWashSoft", WithAlpha(p.AccentWash, 0.55));
        Role("ThAccentFaint", WithAlpha(p.Accent, 0.4));
        Role("ThAccentTone1", WithAlpha(p.Accent, 0.2));
        Role("ThAccentTone2", WithAlpha(p.Accent, 0.34));
        Role("ThFoilTone1", WithAlpha(p.Foil, 0.22));
        Role("ThFoilTone2", WithAlpha(p.Foil, 0.36));
        Role("ThInkTone", WithAlpha(p.InkSecondary, 0.22));
        Role("ThHover", WithAlpha(p.Ink, dark ? 0.08 : 0.05));
        Role("ThPressed", WithAlpha(p.Ink, dark ? 0.12 : 0.09));
        Role("ThSelectedNav", WithAlpha(p.Ink, dark ? 0.09 : 0.06));
        Role("ThShadowSoft", WithAlpha(p.Shadow, dark ? 0.55 : 0.16));

        // Marks that cannot rely on colour where the accent is the ink itself (Mono; design/DECISIONS.md,
        // "Follow-ups"): Sundays and the current month in bold, and the Compare charts' Gregorian bands
        // hatched, since a foil tone and an ink tone are the same grey there.
        var monochrome = IsMonochrome(p);
        d["ThMarkWeight"] = monochrome ? FontWeight.Bold : FontWeight.Medium;
        d["ThFoilBand1"] = monochrome ? Hatch(p.FoilWash, p.Foil) : new SolidColorBrush(WithAlpha(p.Foil, 0.22));
        d["ThFoilBand2"] = monochrome ? Hatch(Mix(p.FoilWash, p.Foil, 0.14), p.Foil) : new SolidColorBrush(WithAlpha(p.Foil, 0.36));

        FluentOverrides(d, p, onControlTint, dark);
        return d;
    }

    /// <summary>
    /// Sets the Fluent theme's light and dark palettes from a theme. The Fluent theme resolves most of
    /// its base brushes once, when they are first used, so this matters for the first theme of a run;
    /// later switches are carried by the control brushes in <see cref="BuildMode"/>.
    /// </summary>
    public static void ApplyFluentPalettes(FluentTheme fluent, ThirteenTheme theme)
    {
        fluent.Palettes[ThemeVariant.Light] = Palette(theme.Palette(dark: false), dark: theme.IsAlwaysDark());
        fluent.Palettes[ThemeVariant.Dark] = Palette(theme.Palette(dark: true), dark: true);
    }

    /// <summary>The Fluent palettes in a Windows contrast theme: both are its system colours.</summary>
    public static void ApplyFluentPalettes(FluentTheme fluent, HighContrastColors colors)
    {
        ArgumentNullException.ThrowIfNull(colors);
        // One palette object per variant: a palette can belong to one owner only.
        fluent.Palettes[ThemeVariant.Light] = Palette(colors.ToPalette(), colors.IsDark);
        fluent.Palettes[ThemeVariant.Dark] = Palette(colors.ToPalette(), colors.IsDark);
    }

    private static ColorPaletteResources Palette(ThemePalette p, bool dark) => new()
    {
        Accent = p.ControlTint,
        RegionColor = p.Paper,
        AltHigh = p.PaperRaised,
        AltLow = WithAlpha(p.PaperRaised, 0.2),
        AltMedium = WithAlpha(p.PaperRaised, 0.6),
        AltMediumHigh = WithAlpha(p.PaperRaised, 0.8),
        AltMediumLow = WithAlpha(p.PaperRaised, 0.4),
        BaseHigh = p.Ink,
        BaseLow = WithAlpha(p.Ink, 0.2),
        BaseMedium = WithAlpha(p.Ink, 0.6),
        BaseMediumHigh = WithAlpha(p.Ink, 0.8),
        BaseMediumLow = WithAlpha(p.Ink, 0.4),
        ChromeAltLow = p.InkSecondary,
        ChromeBlackHigh = p.Shadow,
        ChromeBlackLow = WithAlpha(p.Shadow, 0.2),
        ChromeBlackMedium = WithAlpha(p.Shadow, 0.6),
        ChromeBlackMediumLow = WithAlpha(p.Shadow, 0.4),
        ChromeDisabledHigh = p.Rule,
        ChromeDisabledLow = p.InkTertiary,
        ChromeGray = p.InkTertiary,
        ChromeHigh = p.Rule,
        ChromeLow = dark ? p.PaperRaised : p.Paper,
        ChromeMedium = p.PaperSunk,
        ChromeMediumLow = p.PaperRaised,
        ChromeWhite = OnColor(p.ControlTint, p),
        ListLow = WithAlpha(p.Ink, dark ? 0.08 : 0.05),
        ListMedium = WithAlpha(p.Ink, dark ? 0.14 : 0.1),
    };

    private static void FluentOverrides(ResourceDictionary d, ThemePalette p, Color onTint, bool dark)
    {
        var (light1, light2, light3, dark1, dark2, dark3) = AccentShades(p.ControlTint);
        d["SystemAccentColor"] = p.ControlTint;
        d["SystemAccentColorLight1"] = light1;
        d["SystemAccentColorLight2"] = light2;
        d["SystemAccentColorLight3"] = light3;
        d["SystemAccentColorDark1"] = dark1;
        d["SystemAccentColorDark2"] = dark2;
        d["SystemAccentColorDark3"] = dark3;

        IBrush B(Color c) => new SolidColorBrush(c);
        var paper = B(p.Paper);
        var raised = B(p.PaperRaised);
        var sunk = B(p.PaperSunk);
        var ink = B(p.Ink);
        var ink2 = B(p.InkSecondary);
        var ink3 = B(p.InkTertiary);
        var rule = B(p.Rule);
        var tint = B(p.ControlTint);
        var tintHover = B(dark ? light1 : dark1);
        var tintPressed = B(dark ? dark1 : light1);
        var onTintBrush = B(onTint);
        var hover = B(Mix(p.PaperRaised, p.Ink, dark ? 0.08 : 0.04));
        var pressed = B(Mix(p.PaperRaised, p.Ink, dark ? 0.12 : 0.08));
        var disabledText = B(WithAlpha(p.Ink, 0.38));
        var transparent = B(Colors.Transparent);

        void Set(IBrush brush, params string[] keys)
        {
            foreach (var key in keys) d[key] = brush;
        }

        // Focus rings.
        Set(B(p.Focus), "SystemControlFocusVisualPrimaryBrush");
        Set(B(p.Paper), "SystemControlFocusVisualSecondaryBrush");

        // Plain buttons and repeat buttons (NumericUpDown spinners, calendar header).
        Set(raised, "ButtonBackground", "RepeatButtonBackground", "ToggleButtonBackground");
        Set(hover, "ButtonBackgroundPointerOver", "RepeatButtonBackgroundPointerOver", "ToggleButtonBackgroundPointerOver");
        Set(pressed, "ButtonBackgroundPressed", "RepeatButtonBackgroundPressed", "ToggleButtonBackgroundPressed");
        Set(sunk, "ButtonBackgroundDisabled", "RepeatButtonBackgroundDisabled", "ToggleButtonBackgroundDisabled");
        Set(ink, "ButtonForeground", "ButtonForegroundPointerOver", "ButtonForegroundPressed", "RepeatButtonForeground",
            "RepeatButtonForegroundPointerOver", "RepeatButtonForegroundPressed", "ToggleButtonForeground",
            "ToggleButtonForegroundPointerOver", "ToggleButtonForegroundPressed");
        Set(disabledText, "ButtonForegroundDisabled", "RepeatButtonForegroundDisabled", "ToggleButtonForegroundDisabled");
        Set(rule, "ButtonBorderBrush", "ButtonBorderBrushPointerOver", "ButtonBorderBrushPressed", "ButtonBorderBrushDisabled",
            "RepeatButtonBorderBrush", "RepeatButtonBorderBrushPointerOver", "RepeatButtonBorderBrushPressed",
            "ToggleButtonBorderBrush", "ToggleButtonBorderBrushPointerOver", "ToggleButtonBorderBrushPressed");
        Set(tint, "ToggleButtonBackgroundChecked", "ToggleButtonBorderBrushChecked");
        Set(tintHover, "ToggleButtonBackgroundCheckedPointerOver", "ToggleButtonBorderBrushCheckedPointerOver");
        Set(tintPressed, "ToggleButtonBackgroundCheckedPressed", "ToggleButtonBorderBrushCheckedPressed");
        Set(onTintBrush, "ToggleButtonForegroundChecked", "ToggleButtonForegroundCheckedPointerOver",
            "ToggleButtonForegroundCheckedPressed", "AccentButtonForeground", "AccentButtonForegroundPointerOver",
            "AccentButtonForegroundPressed");
        Set(tint, "AccentButtonBackground");
        Set(tintHover, "AccentButtonBackgroundPointerOver");
        Set(tintPressed, "AccentButtonBackgroundPressed");

        // Text boxes (NumericUpDown, CalendarDatePicker).
        Set(raised, "TextControlBackground", "TextControlBackgroundFocused");
        Set(hover, "TextControlBackgroundPointerOver");
        Set(sunk, "TextControlBackgroundDisabled");
        Set(ink, "TextControlForeground", "TextControlForegroundPointerOver", "TextControlForegroundFocused");
        Set(disabledText, "TextControlForegroundDisabled");
        Set(rule, "TextControlBorderBrush", "TextControlBorderBrushDisabled");
        Set(ink3, "TextControlBorderBrushPointerOver");
        Set(tint, "TextControlBorderBrushFocused");
        Set(ink3, "TextControlPlaceholderForeground", "TextControlPlaceholderForegroundPointerOver",
            "TextControlPlaceholderForegroundFocused");
        Set(B(WithAlpha(p.ControlTint, 0.35)), "TextControlSelectionHighlightColor");
        Set(transparent, "TextControlButtonBackground", "TextControlButtonBorderBrush");
        Set(hover, "TextControlButtonBackgroundPointerOver");
        Set(pressed, "TextControlButtonBackgroundPressed");
        Set(ink2, "TextControlButtonForeground", "TextControlButtonForegroundPointerOver", "TextControlButtonForegroundPressed");

        // Combo boxes.
        Set(raised, "ComboBoxBackground", "ComboBoxBackgroundUnfocused", "ComboBoxDropDownBackground");
        Set(hover, "ComboBoxBackgroundPointerOver");
        Set(pressed, "ComboBoxBackgroundPressed");
        Set(sunk, "ComboBoxBackgroundDisabled");
        Set(rule, "ComboBoxBorderBrush", "ComboBoxDropDownBorderBrush", "ComboBoxBorderBrushDisabled");
        Set(ink3, "ComboBoxBorderBrushPointerOver", "ComboBoxBorderBrushPressed");
        Set(tint, "ComboBoxBackgroundBorderBrushFocused");
        Set(ink, "ComboBoxForeground", "ComboBoxForegroundFocused", "ComboBoxForegroundFocusedPressed",
            "ComboBoxItemForeground", "ComboBoxItemForegroundPointerOver", "ComboBoxItemForegroundPressed",
            "ComboBoxItemForegroundSelected", "ComboBoxItemForegroundSelectedPointerOver", "ComboBoxItemForegroundSelectedPressed");
        Set(ink2, "ComboBoxDropDownGlyphForeground", "ComboBoxDropDownGlyphForegroundFocused",
            "ComboBoxDropDownGlyphForegroundFocusedPressed", "ComboBoxPlaceHolderForeground");
        Set(disabledText, "ComboBoxForegroundDisabled", "ComboBoxItemForegroundDisabled", "ComboBoxDropDownGlyphForegroundDisabled");
        Set(transparent, "ComboBoxItemBackground");
        Set(hover, "ComboBoxItemBackgroundPointerOver");
        Set(pressed, "ComboBoxItemBackgroundPressed");
        Set(B(p.AccentSoft), "ComboBoxItemBackgroundSelected");
        Set(B(Mix(p.PaperRaised, p.Accent, dark ? 0.26 : 0.18)), "ComboBoxItemBackgroundSelectedPointerOver",
            "ComboBoxItemBackgroundSelectedPressed");

        // Calendar and CalendarDatePicker.
        Set(raised, "CalendarViewBackground", "CalendarDatePickerBackground", "CalendarDatePickerBackgroundFocused");
        Set(hover, "CalendarDatePickerBackgroundPointerOver");
        Set(pressed, "CalendarDatePickerBackgroundPressed");
        Set(sunk, "CalendarDatePickerBackgroundDisabled");
        // Day cells sit flat on the calendar (Windows 11 calendar flyout); out-of-month days only fade.
        Set(raised, "CalendarViewCalendarItemRevealBackground", "CalendarViewOutOfScopeBackground");
        Set(transparent, "CalendarViewCalendarItemRevealBorderBrush");
        Set(rule, "CalendarViewBorderBrush", "CalendarDatePickerBorderBrush", "CalendarDatePickerBorderBrushDisabled");
        Set(ink3, "CalendarDatePickerBorderBrushPointerOver", "CalendarDatePickerBorderBrushPressed");
        Set(ink, "CalendarViewForeground", "CalendarViewCalendarItemForeground", "CalendarDatePickerForeground",
            "CalendarDatePickerTextForeground", "CalendarDatePickerTextForegroundSelected");
        Set(ink2, "CalendarDatePickerCalendarGlyphForeground", "CalendarViewNavigationButtonForegroundPointerOver");
        Set(ink3, "CalendarViewOutOfScopeForeground", "CalendarViewBlackoutForeground", "CalendarViewWeekDayForegroundDisabled");
        Set(disabledText, "CalendarDatePickerForegroundDisabled", "CalendarDatePickerTextForegroundDisabled",
            "CalendarDatePickerCalendarGlyphForegroundDisabled");
        Set(ink3, "CalendarViewHoverBorderBrush");
        Set(ink, "CalendarViewPressedBorderBrush");
        Set(tint, "CalendarViewSelectedBorderBrush", "CalendarViewSelectedHoverBorderBrush", "CalendarViewSelectedPressedBorderBrush");
        Set(onTintBrush, "CalendarViewTodayForeground");
        Set(transparent, "CalendarViewNavigationButtonBackground", "CalendarViewNavigationButtonBorderBrush");
        Set(rule, "CalendarViewNavigationButtonBorderBrushPointerOver");

        // Toggle switches.
        Set(transparent, "ToggleSwitchFillOff");
        Set(hover, "ToggleSwitchFillOffPointerOver");
        Set(pressed, "ToggleSwitchFillOffPressed");
        Set(ink2, "ToggleSwitchStrokeOff", "ToggleSwitchStrokeOffPointerOver", "ToggleSwitchStrokeOffPressed",
            "ToggleSwitchKnobFillOff", "ToggleSwitchKnobFillOffPointerOver", "ToggleSwitchKnobFillOffPressed");
        Set(tint, "ToggleSwitchFillOn", "ToggleSwitchStrokeOn");
        Set(tintHover, "ToggleSwitchFillOnPointerOver", "ToggleSwitchStrokeOnPointerOver");
        Set(tintPressed, "ToggleSwitchFillOnPressed", "ToggleSwitchStrokeOnPressed");
        Set(onTintBrush, "ToggleSwitchKnobFillOn", "ToggleSwitchKnobFillOnPointerOver", "ToggleSwitchKnobFillOnPressed");
        Set(ink, "ToggleSwitchContentForeground");

        // Radio buttons.
        Set(ink, "RadioButtonForeground", "RadioButtonForegroundPointerOver", "RadioButtonForegroundPressed");
        Set(ink2, "RadioButtonOuterEllipseStroke", "RadioButtonOuterEllipseStrokePointerOver");
        Set(ink, "RadioButtonOuterEllipseStrokePressed");
        Set(raised, "RadioButtonOuterEllipseFill");
        Set(hover, "RadioButtonOuterEllipseFillPointerOver");
        Set(pressed, "RadioButtonOuterEllipseFillPressed");
        Set(tint, "RadioButtonOuterEllipseCheckedStroke", "RadioButtonOuterEllipseCheckedFill");
        Set(tintHover, "RadioButtonOuterEllipseCheckedStrokePointerOver", "RadioButtonOuterEllipseCheckedFillPointerOver");
        Set(tintPressed, "RadioButtonOuterEllipseCheckedStrokePressed", "RadioButtonOuterEllipseCheckedFillPressed");
        Set(onTintBrush, "RadioButtonCheckGlyphFill", "RadioButtonCheckGlyphFillPointerOver", "RadioButtonCheckGlyphFillPressed");

        // Tooltips, flyouts, menus, scroll bars.
        Set(raised, "ToolTipBackground", "FlyoutPresenterBackground", "MenuFlyoutPresenterBackground",
            "DatePickerFlyoutPresenterBackground");
        Set(ink, "ToolTipForeground", "MenuFlyoutItemForeground", "MenuFlyoutItemForegroundPointerOver");
        Set(rule, "ToolTipBorderBrush", "FlyoutBorderThemeBrush", "MenuFlyoutPresenterBorderBrush",
            "DatePickerFlyoutPresenterBorderBrush");
        Set(hover, "MenuFlyoutItemBackgroundPointerOver");
        Set(pressed, "MenuFlyoutItemBackgroundPressed");
        d["ScrollBarThumbBackgroundColor"] = WithAlpha(p.Ink, 0.45);
        d["ScrollBarPanningThumbBackgroundColor"] = WithAlpha(p.Ink, 0.3);
        Set(B(WithAlpha(p.Ink, 0.45)), "ScrollBarThumbFillPointerOver", "ScrollBarThumbFillPressed",
            "ScrollBarPanningThumbBackground");
        Set(transparent, "ScrollBarBackground");
        Set(B(WithAlpha(p.PaperRaised, 0.9)), "ScrollBarTrackFill", "ScrollBarTrackFillPointerOver");
        Set(ink2, "ScrollBarButtonArrowForeground", "ScrollBarButtonArrowForegroundPointerOver");

        // Window-level defaults.
        Set(paper, "SystemControlBackgroundAltHighBrush");
        Set(B(p.AccentSoft), "TextSelectionHighlightColor");
    }

    /// <summary>Whether the theme's accent is its ink (Mono), so colour alone cannot tell marks apart.</summary>
    public static bool IsMonochrome(ThemePalette p) => p.Accent == p.Ink;

    /// <summary>
    /// A 45 degree hatch: 1 px lines of <paramref name="line"/> at 40% every 5 px over <paramref name="fill"/>
    /// (the web's --t-foil-hatch). Ink text on it keeps more than 4.5:1 in both Mono modes.
    /// </summary>
    public static IBrush Hatch(Color fill, Color line)
    {
        const double size = 5;
        var stroke = new Pen(new SolidColorBrush(WithAlpha(line, 0.4)), 1);
        var lines = new PathGeometry();
        // The diagonal plus the two corner pieces, so the tiles join without gaps.
        foreach (var (from, to) in new[] { (new Point(0, size), new Point(size, 0)), (new Point(-1, 1), new Point(1, -1)), (new Point(size - 1, size + 1), new Point(size + 1, size - 1)) })
        {
            var figure = new PathFigure { StartPoint = from, IsClosed = false };
            figure.Segments!.Add(new LineSegment { Point = to });
            lines.Figures!.Add(figure);
        }
        var tile = new DrawingGroup
        {
            ClipGeometry = new RectangleGeometry(new Rect(0, 0, size, size)),
            Children =
            {
                new GeometryDrawing { Brush = new SolidColorBrush(fill), Geometry = new RectangleGeometry(new Rect(0, 0, size, size)) },
                new GeometryDrawing { Pen = stroke, Geometry = lines },
            },
        };
        return new DrawingBrush(tile)
        {
            TileMode = TileMode.Tile,
            Stretch = Stretch.None,
            SourceRect = new RelativeRect(0, 0, size, size, RelativeUnit.Absolute),
            DestinationRect = new RelativeRect(0, 0, size, size, RelativeUnit.Absolute),
        };
    }

    /// <summary>Near-white or near-black text for a fill: whichever of the palette's ink and paper reads better.</summary>
    public static Color OnColor(Color fill, ThemePalette p)
    {
        var light = Luminance(p.Ink) > Luminance(p.PaperRaised) ? p.Ink : p.PaperRaised;
        var darkText = Luminance(p.Ink) > Luminance(p.PaperRaised) ? p.PaperRaised : p.Ink;
        return Contrast(fill, light) >= Contrast(fill, darkText) ? light : darkText;
    }

    /// <summary>WCAG 2 contrast ratio of two opaque colours, 1..21.</summary>
    public static double Contrast(Color a, Color b)
    {
        var la = Luminance(a);
        var lb = Luminance(b);
        return (Math.Max(la, lb) + 0.05) / (Math.Min(la, lb) + 0.05);
    }

    /// <summary>WCAG 2 relative luminance of an sRGB colour.</summary>
    public static double Luminance(Color c)
    {
        static double Channel(byte v)
        {
            var s = v / 255.0;
            return s <= 0.04045 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * Channel(c.R) + 0.7152 * Channel(c.G) + 0.0722 * Channel(c.B);
    }

    /// <summary>The colour with its alpha multiplied by <paramref name="opacity"/>.</summary>
    public static Color WithAlpha(Color c, double opacity) =>
        Color.FromArgb((byte)Math.Round(c.A * Math.Clamp(opacity, 0, 1)), c.R, c.G, c.B);

    /// <summary><paramref name="a"/> moved <paramref name="amount"/> (0..1) towards <paramref name="b"/>, opaque.</summary>
    public static Color Mix(Color a, Color b, double amount)
    {
        byte M(byte x, byte y) => (byte)Math.Round(x + (y - x) * amount);
        return Color.FromRgb(M(a.R, b.R), M(a.G, b.G), M(a.B, b.B));
    }

    private static (Color Light1, Color Light2, Color Light3, Color Dark1, Color Dark2, Color Dark3) AccentShades(Color c)
    {
        var white = Color.FromRgb(0xFF, 0xFF, 0xFF);
        var black = Color.FromRgb(0x00, 0x00, 0x00);
        return (Mix(c, white, 0.15), Mix(c, white, 0.3), Mix(c, white, 0.45), Mix(c, black, 0.12), Mix(c, black, 0.24), Mix(c, black, 0.36));
    }
}
