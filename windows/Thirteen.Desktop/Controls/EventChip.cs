using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Thirteen.Desktop.Themes;

namespace Thirteen.Desktop.Controls;

/// <summary>
/// An event chip or bar as the Calendar draws it (docs/EVENTS.md §2.2), drawn like the other controls of Drawn.cs:
/// <list type="bullet">
/// <item>a <b>bar</b> (all-day, or 24 hours or more): a fill of the calendar color at 16 % over <c>paper-raised</c> (24 %
/// on dark themes) with a 2 px edge in the color on its leading side and the title in <c>ink</c>; a side that continues
/// before or after the row is squared with a 6 px chevron cut instead of rounded;</item>
/// <item>a <b>dot</b> (a shorter timed event in Month): a 6 px dot with a 1 px <c>rule</c> ring, the start time in Geist
/// Mono and the title.</item>
/// </list>
/// Tentative events get a diagonal hatch at 8 %; canceled ones a title struck through in <c>ink-2</c>. The color marks the
/// event and never carries text. The control is the visual only; its Button (Views/Calendar) gives focus, clicks and the
/// accessible name.
/// <para>
/// In a Windows contrast theme (<see cref="HighContrast"/>, §2.20 "Forced colors and high contrast", the web's
/// forced-colors rules) the colours are the system's: every chip and bar is <c>Canvas</c> with a 1 px <c>CanvasText</c>
/// border and no tint or colored edge, a tentative one has a dashed border instead of the hatch, the dot keeps its
/// <c>CanvasText</c> ring, and the selected one a 2 px <c>Highlight</c> outline.
/// </para>
/// </summary>
public sealed class EventChipVisual : Control
{
    /// <summary>A bar rather than a dot item.</summary>
    public static readonly StyledProperty<bool> IsBarProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(IsBar));

    /// <summary>The calendar color.</summary>
    public static readonly StyledProperty<Color> EventColorProperty = AvaloniaProperty.Register<EventChipVisual, Color>(nameof(EventColor), Colors.Gray);

    /// <summary>The title (user text).</summary>
    public static readonly StyledProperty<string?> TitleProperty = AvaloniaProperty.Register<EventChipVisual, string?>(nameof(Title));

    /// <summary>The compact start time of a dot item ("09:30", "9:30a"), or null.</summary>
    public static readonly StyledProperty<string?> TimeProperty = AvaloniaProperty.Register<EventChipVisual, string?>(nameof(Time));

    /// <summary>The bar continues before the row (squared, notched start).</summary>
    public static readonly StyledProperty<bool> ContinuesBeforeProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(ContinuesBefore));

    /// <summary>The bar continues after the row (squared, pointed end).</summary>
    public static readonly StyledProperty<bool> ContinuesAfterProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(ContinuesAfter));

    /// <summary>Tentative: a diagonal hatch at 8 %.</summary>
    public static readonly StyledProperty<bool> IsTentativeProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(IsTentative));

    /// <summary>Canceled: the title struck through in ink-2.</summary>
    public static readonly StyledProperty<bool> IsCanceledProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(IsCanceled));

    /// <summary>The selected event: an inset ink outline.</summary>
    public static readonly StyledProperty<bool> IsSelectedProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(IsSelected));

    /// <summary><c>paper-raised</c> of the theme (set by the style in Themes/Calendar.axaml).</summary>
    public static readonly StyledProperty<Color> SurfaceColorProperty = AvaloniaProperty.Register<EventChipVisual, Color>(nameof(SurfaceColor), Colors.White);

    /// <summary><c>ink</c>.</summary>
    public static readonly StyledProperty<Color> InkColorProperty = AvaloniaProperty.Register<EventChipVisual, Color>(nameof(InkColor), Colors.Black);

    /// <summary><c>ink-2</c>.</summary>
    public static readonly StyledProperty<Color> Ink2ColorProperty = AvaloniaProperty.Register<EventChipVisual, Color>(nameof(Ink2Color), Colors.DimGray);

    /// <summary><c>rule</c> (the dot's ring).</summary>
    public static readonly StyledProperty<Color> RuleColorProperty = AvaloniaProperty.Register<EventChipVisual, Color>(nameof(RuleColor), Colors.LightGray);

    /// <summary>Text size (11 at 100 % text scale, §2.2 "Minimum sizes").</summary>
    public static readonly StyledProperty<double> TextSizeProperty = AvaloniaProperty.Register<EventChipVisual, double>(nameof(TextSize), 11);

    /// <summary>A Windows contrast theme is on (the <c>ThHighContrast</c> resource): the forced-colors look.</summary>
    public static readonly StyledProperty<bool> HighContrastProperty = AvaloniaProperty.Register<EventChipVisual, bool>(nameof(HighContrast));

    /// <summary><c>accent</c>, which is <c>Highlight</c> in a contrast theme (the selected outline there).</summary>
    public static readonly StyledProperty<Color> HighlightColorProperty = AvaloniaProperty.Register<EventChipVisual, Color>(nameof(HighlightColor), Colors.DodgerBlue);

    static EventChipVisual()
    {
        AffectsRender<EventChipVisual>(IsBarProperty, EventColorProperty, TitleProperty, TimeProperty, ContinuesBeforeProperty, ContinuesAfterProperty,
            IsTentativeProperty, IsCanceledProperty, IsSelectedProperty, SurfaceColorProperty, InkColorProperty, Ink2ColorProperty, RuleColorProperty,
            TextSizeProperty, HighContrastProperty, HighlightColorProperty);
        AffectsMeasure<EventChipVisual>(TextSizeProperty);
    }

    /// <inheritdoc cref="IsBarProperty"/>
    public bool IsBar { get => GetValue(IsBarProperty); set => SetValue(IsBarProperty, value); }

    /// <inheritdoc cref="EventColorProperty"/>
    public Color EventColor { get => GetValue(EventColorProperty); set => SetValue(EventColorProperty, value); }

    /// <inheritdoc cref="TitleProperty"/>
    public string? Title { get => GetValue(TitleProperty); set => SetValue(TitleProperty, value); }

    /// <inheritdoc cref="TimeProperty"/>
    public string? Time { get => GetValue(TimeProperty); set => SetValue(TimeProperty, value); }

    /// <inheritdoc cref="ContinuesBeforeProperty"/>
    public bool ContinuesBefore { get => GetValue(ContinuesBeforeProperty); set => SetValue(ContinuesBeforeProperty, value); }

    /// <inheritdoc cref="ContinuesAfterProperty"/>
    public bool ContinuesAfter { get => GetValue(ContinuesAfterProperty); set => SetValue(ContinuesAfterProperty, value); }

    /// <inheritdoc cref="IsTentativeProperty"/>
    public bool IsTentative { get => GetValue(IsTentativeProperty); set => SetValue(IsTentativeProperty, value); }

    /// <inheritdoc cref="IsCanceledProperty"/>
    public bool IsCanceled { get => GetValue(IsCanceledProperty); set => SetValue(IsCanceledProperty, value); }

    /// <inheritdoc cref="IsSelectedProperty"/>
    public bool IsSelected { get => GetValue(IsSelectedProperty); set => SetValue(IsSelectedProperty, value); }

    /// <inheritdoc cref="SurfaceColorProperty"/>
    public Color SurfaceColor { get => GetValue(SurfaceColorProperty); set => SetValue(SurfaceColorProperty, value); }

    /// <inheritdoc cref="InkColorProperty"/>
    public Color InkColor { get => GetValue(InkColorProperty); set => SetValue(InkColorProperty, value); }

    /// <inheritdoc cref="Ink2ColorProperty"/>
    public Color Ink2Color { get => GetValue(Ink2ColorProperty); set => SetValue(Ink2ColorProperty, value); }

    /// <inheritdoc cref="RuleColorProperty"/>
    public Color RuleColor { get => GetValue(RuleColorProperty); set => SetValue(RuleColorProperty, value); }

    /// <inheritdoc cref="TextSizeProperty"/>
    public double TextSize { get => GetValue(TextSizeProperty); set => SetValue(TextSizeProperty, value); }

    /// <inheritdoc cref="HighContrastProperty"/>
    public bool HighContrast { get => GetValue(HighContrastProperty); set => SetValue(HighContrastProperty, value); }

    /// <inheritdoc cref="HighlightColorProperty"/>
    public Color HighlightColor { get => GetValue(HighlightColorProperty); set => SetValue(HighlightColorProperty, value); }

    /// <summary>The border of a chip or bar in a contrast theme: 1 px, dashed for a tentative event (§2.20).</summary>
    internal static ImmutablePen ContrastPen(Color ink, bool tentative) =>
        new(new ImmutableSolidColorBrush(ink), 1, tentative ? new ImmutableDashStyle([3, 2], 0) : null);

    private const double Notch = 6;
    private const double Radius = 4;

    /// <summary>The bar fill: the color at 16 % over the surface, 24 % on a dark surface (§2.2, §2.20 "Contrast").</summary>
    public static Color BarFill(Color color, Color surface) =>
        ThemeResources.Mix(surface, color, ThemeResources.Luminance(surface) < 0.2 ? 0.24 : 0.16);

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize) =>
        new(double.IsInfinity(availableSize.Width) ? 120 : availableSize.Width, Math.Ceiling(TextSize * 1.6));

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);
        if (bounds.Width <= 2 || bounds.Height <= 2) return;
        var ink = InkColor;
        var titleColor = IsCanceled ? Ink2Color : ink;
        var x = 0.0;
        Geometry? shape = null;
        var contrast = HighContrast;
        if (contrast)
        {
            // Canvas with a 1 px CanvasText border (dashed when tentative), no tint, no colored edge; a dot keeps its ring.
            var box = bounds.Deflate(0.5);
            shape = IsBar ? BarGeometry(box, ContinuesBefore, ContinuesAfter) : new RectangleGeometry(box, Radius, Radius);
            context.DrawGeometry(new ImmutableSolidColorBrush(SurfaceColor), ContrastPen(ink, IsTentative), shape);
            if (IsBar)
            {
                x = ContinuesBefore ? Notch + 2 : 6;
            }
            else
            {
                var dot = 6.0;
                context.DrawEllipse(new ImmutableSolidColorBrush(EventColor), new ImmutablePen(new ImmutableSolidColorBrush(RuleColor), 1),
                    new Point(5 + dot / 2, bounds.Height / 2), dot / 2, dot / 2);
                x = 5 + dot + 4;
            }
        }
        else if (IsBar)
        {
            shape = BarGeometry(bounds, ContinuesBefore, ContinuesAfter);
            context.DrawGeometry(new ImmutableSolidColorBrush(BarFill(EventColor, SurfaceColor)), null, shape);
            if (!ContinuesBefore)
            {
                // The 2 px edge follows the rounded start. An intersected geometry rather than PushClip: with the GPU
                // renderer on macOS a pushed rounded clip also hid the title drawn after it.
                var edge = new CombinedGeometry(GeometryCombineMode.Intersect, shape, new RectangleGeometry(new Rect(0, 0, 2, bounds.Height)));
                context.DrawGeometry(new ImmutableSolidColorBrush(EventColor), null, edge);
            }
            x = ContinuesBefore ? Notch + 2 : 7;
        }
        else
        {
            var size = 6.0;
            var center = new Point(5 + size / 2, bounds.Height / 2);
            context.DrawEllipse(new ImmutableSolidColorBrush(EventColor), new ImmutablePen(new ImmutableSolidColorBrush(RuleColor), 1), center, size / 2, size / 2);
            x = 5 + size + 4;
        }

        if (IsTentative && !contrast)
        {
            // Diagonal lines cut to the chip's box by hand (no PushClip, see above).
            var pen = new ImmutablePen(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(ink, 0.08)), 1.5);
            var h = bounds.Height;
            for (var d = -h; d < bounds.Width; d += 5)
            {
                // The line from (d, h) to (d + h, 0), limited to 0 <= x <= width.
                var x0 = Math.Max(d, 0);
                var x1 = Math.Min(d + h, bounds.Width);
                if (x1 <= x0) continue;
                context.DrawLine(pen, new Point(x0, h - (x0 - d)), new Point(x1, h - (x1 - d)));
            }
        }

        var right = bounds.Width - (IsBar && ContinuesAfter ? Notch + 2 : 5);
        if (!IsBar && !string.IsNullOrEmpty(Time))
        {
            var time = AppFonts.Text(Time!, AppFonts.Mono, TextSize, FontWeight.Regular, new ImmutableSolidColorBrush(Ink2Color));
            if (x + time.Width < right)
            {
                context.DrawText(time, new Point(x, (bounds.Height - time.Height) / 2));
                x += time.Width + 4;
            }
        }
        if (!string.IsNullOrEmpty(Title) && right - x > 4)
        {
            var title = AppFonts.Text(Title!, AppFonts.Sans, TextSize, FontWeight.Medium, new ImmutableSolidColorBrush(titleColor));
            title.MaxTextWidth = right - x;
            title.MaxLineCount = 1;
            title.Trimming = TextTrimming.CharacterEllipsis;
            var top = (bounds.Height - title.Height) / 2;
            context.DrawText(title, new Point(x, top));
            if (IsCanceled)
            {
                var y = Math.Round(top + title.Height * 0.55) + 0.5;
                context.DrawLine(new ImmutablePen(new ImmutableSolidColorBrush(titleColor), 1), new Point(x, y), new Point(x + Math.Min(title.WidthIncludingTrailingWhitespace, right - x), y));
            }
        }

        if (IsSelected)
        {
            // An ink outline; a 2 px Highlight one in a contrast theme (the web's forced-colors outline).
            var pen = contrast ? new ImmutablePen(new ImmutableSolidColorBrush(HighlightColor), 2) : new ImmutablePen(new ImmutableSolidColorBrush(ink), 1.5);
            var inset = bounds.Deflate(contrast ? 1 : 0.75);
            if (IsBar) context.DrawGeometry(null, pen, BarGeometry(inset, ContinuesBefore, ContinuesAfter));
            else context.DrawRectangle(null, pen, inset, Radius, Radius);
        }
    }

    /// <summary>The bar's outline: rounded ends, or a 6 px notch (start) and point (end) where it continues.</summary>
    private static Geometry BarGeometry(Rect r, bool before, bool after)
    {
        if (!before && !after) return new RectangleGeometry(r, Radius, Radius);
        var geometry = new StreamGeometry();
        using var g = geometry.Open();
        var top = r.Top;
        var bottom = r.Bottom;
        var middle = (top + bottom) / 2;
        if (before)
        {
            g.BeginFigure(new Point(r.Left, top), true);
        }
        else
        {
            g.BeginFigure(new Point(r.Left + Radius, top), true);
        }
        if (after)
        {
            g.LineTo(new Point(r.Right - Notch, top));
            g.LineTo(new Point(r.Right, middle));
            g.LineTo(new Point(r.Right - Notch, bottom));
        }
        else
        {
            g.LineTo(new Point(r.Right - Radius, top));
            g.ArcTo(new Point(r.Right, top + Radius), new Size(Radius, Radius), 0, false, SweepDirection.Clockwise);
            g.LineTo(new Point(r.Right, bottom - Radius));
            g.ArcTo(new Point(r.Right - Radius, bottom), new Size(Radius, Radius), 0, false, SweepDirection.Clockwise);
        }
        if (before)
        {
            g.LineTo(new Point(r.Left, bottom));
            g.LineTo(new Point(r.Left + Notch, middle));
        }
        else
        {
            g.LineTo(new Point(r.Left + Radius, bottom));
            g.ArcTo(new Point(r.Left, bottom - Radius), new Size(Radius, Radius), 0, false, SweepDirection.Clockwise);
            g.LineTo(new Point(r.Left, top + Radius));
            g.ArcTo(new Point(r.Left + Radius, top), new Size(Radius, Radius), 0, false, SweepDirection.Clockwise);
        }
        g.EndFigure(true);
        return geometry;
    }
}

/// <summary>
/// Up to three event dots in calendar colors (Year mode: 4 px, §2.3), side by side and centred. Reserves its height even
/// when empty, so a year's cells keep one height whether or not a day has events.
/// </summary>
public sealed class EventDots : Control
{
    /// <summary>The dot colors (at most the first three are drawn).</summary>
    public static readonly StyledProperty<IReadOnlyList<Color>?> DotColorsProperty =
        AvaloniaProperty.Register<EventDots, IReadOnlyList<Color>?>(nameof(DotColors));

    /// <summary>The dot diameter.</summary>
    public static readonly StyledProperty<double> DotSizeProperty = AvaloniaProperty.Register<EventDots, double>(nameof(DotSize), 4);

    /// <summary>A ring around each dot (6 px dots get a 1 px <c>rule</c> ring, §2.2), or transparent.</summary>
    public static readonly StyledProperty<Color> RingColorProperty = AvaloniaProperty.Register<EventDots, Color>(nameof(RingColor), Colors.Transparent);

    static EventDots()
    {
        AffectsRender<EventDots>(DotColorsProperty, DotSizeProperty, RingColorProperty);
        AffectsMeasure<EventDots>(DotColorsProperty, DotSizeProperty);
    }

    /// <inheritdoc cref="DotColorsProperty"/>
    public IReadOnlyList<Color>? DotColors { get => GetValue(DotColorsProperty); set => SetValue(DotColorsProperty, value); }

    /// <inheritdoc cref="DotSizeProperty"/>
    public double DotSize { get => GetValue(DotSizeProperty); set => SetValue(DotSizeProperty, value); }

    /// <inheritdoc cref="RingColorProperty"/>
    public Color RingColor { get => GetValue(RingColorProperty); set => SetValue(RingColorProperty, value); }

    private const double Gap = 2;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var count = Math.Min(3, DotColors?.Count ?? 0);
        return new Size(count == 0 ? 0 : count * DotSize + (count - 1) * Gap, DotSize);
    }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        if (DotColors is not { Count: > 0 } colors) return;
        var count = Math.Min(3, colors.Count);
        var width = count * DotSize + (count - 1) * Gap;
        var x = (Bounds.Width - width) / 2;
        var pen = RingColor.A == 0 ? null : new ImmutablePen(new ImmutableSolidColorBrush(RingColor), 1);
        for (var i = 0; i < count; i++)
        {
            var center = new Point(x + DotSize / 2 + i * (DotSize + Gap), Bounds.Height / 2);
            context.DrawEllipse(new ImmutableSolidColorBrush(colors[i]), pen, center, DotSize / 2, DotSize / 2);
        }
    }
}
