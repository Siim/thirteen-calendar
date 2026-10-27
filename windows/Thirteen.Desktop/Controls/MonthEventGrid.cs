using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Controls;

/// <summary>
/// Lays out one week row of the Month grid (docs/EVENTS.md §2.4) from its children's models
/// (<see cref="IMonthPlacement"/>): a day cell (lane -1) fills its column for the whole row height, a chip, bar or
/// "+N more" sits in its lane under the day header (<see cref="HeaderHeight"/>), across its columns. The lanes that fit
/// are worked out by the view (<see cref="MonthModeViewModel.SetGeometry"/>), so nothing here is clipped.
/// </summary>
public sealed class MonthWeekPanel : Panel
{
    /// <summary>The day header of a cell (the day number and the Gregorian day).</summary>
    public static readonly StyledProperty<double> HeaderHeightProperty =
        AvaloniaProperty.Register<MonthWeekPanel, double>(nameof(HeaderHeight), 30);

    /// <summary>The height of one lane.</summary>
    public static readonly StyledProperty<double> LaneHeightProperty =
        AvaloniaProperty.Register<MonthWeekPanel, double>(nameof(LaneHeight), 20);

    static MonthWeekPanel()
    {
        AffectsMeasure<MonthWeekPanel>(HeaderHeightProperty, LaneHeightProperty);
        AffectsArrange<MonthWeekPanel>(HeaderHeightProperty, LaneHeightProperty);
    }

    /// <inheritdoc cref="HeaderHeightProperty"/>
    public double HeaderHeight { get => GetValue(HeaderHeightProperty); set => SetValue(HeaderHeightProperty, value); }

    /// <inheritdoc cref="LaneHeightProperty"/>
    public double LaneHeight { get => GetValue(LaneHeightProperty); set => SetValue(LaneHeightProperty, value); }

    /// <summary>The gap between a chip and its cell's sides.</summary>
    public const double Inset = 3;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var width = double.IsInfinity(availableSize.Width) ? 7 * 120 : availableSize.Width;
        var lanes = 0;
        foreach (var child in Children)
        {
            if (child.DataContext is IMonthPlacement { Lane: >= 0 } p) lanes = Math.Max(lanes, p.Lane + 1);
        }
        var height = double.IsInfinity(availableSize.Height) ? HeaderHeight + lanes * LaneHeight + 4 : availableSize.Height;
        foreach (var child in Children) child.Measure(Slot(child, width, height).Size);
        return new Size(width, height);
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        foreach (var child in Children) child.Arrange(Slot(child, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    private Rect Slot(Control child, double width, double height)
    {
        if (child.DataContext is not IMonthPlacement p) return new Rect(0, 0, 0, 0);
        var column = width / 7;
        var x = Math.Round(p.Column * column);
        var right = Math.Round((p.Column + p.ColumnSpan) * column);
        if (p.Lane < 0) return new Rect(x, 0, Math.Max(0, right - x), height);
        var top = HeaderHeight + p.Lane * LaneHeight;
        return new Rect(x + Inset, top + 1, Math.Max(0, right - x - 2 * Inset), Math.Max(0, LaneHeight - 2));
    }
}

/// <summary>
/// A diagonal hatch (the intercalary band, as the existing intercalary badge draws it, §2.2). In a Windows contrast theme
/// (<see cref="HighContrast"/>, §2.20) it is a dashed <see cref="BorderColor"/> frame instead, as the web's band is under
/// forced colors.
/// </summary>
public sealed class HatchFill : Control
{
    /// <summary>A Windows contrast theme is on (the <c>ThHighContrast</c> resource): a dashed frame, no hatch.</summary>
    public static readonly StyledProperty<bool> HighContrastProperty = AvaloniaProperty.Register<HatchFill, bool>(nameof(HighContrast));

    /// <summary>The dashed frame's color in a contrast theme (<c>CanvasText</c>).</summary>
    public static readonly StyledProperty<Color> BorderColorProperty = AvaloniaProperty.Register<HatchFill, Color>(nameof(BorderColor), Colors.Black);

    /// <inheritdoc cref="HighContrastProperty"/>
    public bool HighContrast { get => GetValue(HighContrastProperty); set => SetValue(HighContrastProperty, value); }

    /// <inheritdoc cref="BorderColorProperty"/>
    public Color BorderColor { get => GetValue(BorderColorProperty); set => SetValue(BorderColorProperty, value); }

    /// <summary>The line color.</summary>
    public static readonly StyledProperty<Color> LineColorProperty =
        AvaloniaProperty.Register<HatchFill, Color>(nameof(LineColor), Color.FromArgb(0x30, 0x80, 0x80, 0x80));

    /// <summary>The distance between lines.</summary>
    public static readonly StyledProperty<double> SpacingProperty = AvaloniaProperty.Register<HatchFill, double>(nameof(Spacing), 7);

    static HatchFill()
    {
        AffectsRender<HatchFill>(LineColorProperty, SpacingProperty, HighContrastProperty, BorderColorProperty);
        IsHitTestVisibleProperty.OverrideDefaultValue<HatchFill>(false);
    }

    /// <inheritdoc cref="LineColorProperty"/>
    public Color LineColor { get => GetValue(LineColorProperty); set => SetValue(LineColorProperty, value); }

    /// <inheritdoc cref="SpacingProperty"/>
    public double Spacing { get => GetValue(SpacingProperty); set => SetValue(SpacingProperty, value); }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);
        if (bounds.Width <= 0 || bounds.Height <= 0 || Spacing <= 0) return;
        if (HighContrast)
        {
            if (bounds.Width > 4 && bounds.Height > 4)
            {
                context.DrawRectangle(null, new ImmutablePen(new ImmutableSolidColorBrush(BorderColor), 1, new ImmutableDashStyle([4, 3], 0)), bounds.Deflate(2.5));
            }
            return;
        }
        var pen = new ImmutablePen(new ImmutableSolidColorBrush(LineColor), 1);
        var h = bounds.Height;
        for (var d = -h; d < bounds.Width; d += Spacing)
        {
            // The line from (d, h) to (d + h, 0), cut to the control's box by hand rather than with PushClip.
            var x0 = Math.Max(d, 0);
            var x1 = Math.Min(d + h, bounds.Width);
            if (x1 > x0) context.DrawLine(pen, new Point(x0, h - (x0 - d)), new Point(x1, h - (x1 - d)));
        }
    }
}

/// <summary>
/// The Calendar toolbar's row (§2.1): the first child (paging, title and subtitle, status) takes the room left by the
/// others (the mode control, "New event"); when they do not all fit, the others move to a second line under it, and on to
/// further lines when one line is not wide enough for them either (Windows' largest text sizes), so nothing is cut at the
/// narrowest window or the largest text. The Calendars pane's group headers use it too (the title, then "Hide all").
/// </summary>
public sealed class ToolbarLayout : Panel
{
    /// <summary>The gap between the parts, and between the lines.</summary>
    public static readonly StyledProperty<double> SpacingProperty = AvaloniaProperty.Register<ToolbarLayout, double>(nameof(Spacing), 12);

    /// <summary>The narrowest the first part may get before the others wrap.</summary>
    public static readonly StyledProperty<double> LeadingMinWidthProperty =
        AvaloniaProperty.Register<ToolbarLayout, double>(nameof(LeadingMinWidth), 320);

    private bool _wrapped;
    private readonly List<Rect> _wrappedSlots = [];

    static ToolbarLayout()
    {
        AffectsMeasure<ToolbarLayout>(SpacingProperty, LeadingMinWidthProperty);
    }

    /// <inheritdoc cref="SpacingProperty"/>
    public double Spacing { get => GetValue(SpacingProperty); set => SetValue(SpacingProperty, value); }

    /// <inheritdoc cref="LeadingMinWidthProperty"/>
    public double LeadingMinWidth { get => GetValue(LeadingMinWidthProperty); set => SetValue(LeadingMinWidthProperty, value); }

    /// <summary>Whether the trailing parts are on a second line.</summary>
    public bool IsWrapped => _wrapped;

    private IEnumerable<Control> Trailing => Children.Skip(1).Where(c => c.IsVisible);

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        if (Children.Count == 0) return default;
        var leading = Children[0];
        var infinite = new Size(double.PositiveInfinity, availableSize.Height);
        double trailingWidth = 0, trailingHeight = 0;
        var count = 0;
        foreach (var child in Trailing)
        {
            child.Measure(infinite);
            trailingWidth += child.DesiredSize.Width;
            trailingHeight = Math.Max(trailingHeight, child.DesiredSize.Height);
            count++;
        }
        if (count > 0) trailingWidth += Spacing * (count - 1);
        leading.Measure(infinite);
        var leadingWanted = Math.Min(leading.DesiredSize.Width, LeadingMinWidth);
        var width = availableSize.Width;
        _wrapped = count > 0 && !double.IsInfinity(width) && leadingWanted + Spacing + trailingWidth > width;
        if (_wrapped)
        {
            leading.Measure(new Size(width, availableSize.Height));
            // The others flow under it, left to right, starting a new line when the next one does not fit.
            _wrappedSlots.Clear();
            var top = leading.DesiredSize.Height + Spacing / 2;
            double x = 0, lineHeight = 0;
            var lineStart = 0;
            foreach (var child in Trailing)
            {
                var size = child.DesiredSize;
                if (x > 0 && x + size.Width > width)
                {
                    FinishLine(lineStart, lineHeight);
                    lineStart = _wrappedSlots.Count;
                    top += lineHeight + Spacing / 2;
                    x = 0;
                    lineHeight = 0;
                }
                _wrappedSlots.Add(new Rect(x, top, Math.Min(size.Width, width), size.Height));
                x += size.Width + Spacing;
                lineHeight = Math.Max(lineHeight, size.Height);
            }
            FinishLine(lineStart, lineHeight);
            return new Size(width, top + lineHeight);
        }
        var leadingRoom = double.IsInfinity(width) ? double.PositiveInfinity : Math.Max(0, width - trailingWidth - (count > 0 ? Spacing : 0));
        leading.Measure(new Size(leadingRoom, availableSize.Height));
        var desiredWidth = double.IsInfinity(width) ? leading.DesiredSize.Width + Spacing + trailingWidth : width;
        return new Size(desiredWidth, Math.Max(leading.DesiredSize.Height, trailingHeight));
    }

    /// <summary>Gives every slot of a finished line of the wrapped parts that line's height.</summary>
    private void FinishLine(int start, double height)
    {
        for (var i = start; i < _wrappedSlots.Count; i++) _wrappedSlots[i] = _wrappedSlots[i].WithHeight(height);
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        if (Children.Count == 0) return finalSize;
        var leading = Children[0];
        var trailing = Trailing.ToArray();
        var trailingWidth = trailing.Sum(c => c.DesiredSize.Width) + Spacing * Math.Max(0, trailing.Length - 1);
        if (_wrapped)
        {
            leading.Arrange(new Rect(0, 0, finalSize.Width, leading.DesiredSize.Height));
            for (var i = 0; i < trailing.Length; i++)
            {
                trailing[i].Arrange(i < _wrappedSlots.Count ? _wrappedSlots[i] : default);
            }
            return finalSize;
        }
        var leadingWidth = Math.Max(0, finalSize.Width - trailingWidth - (trailing.Length > 0 ? Spacing : 0));
        leading.Arrange(new Rect(0, 0, leadingWidth, finalSize.Height));
        var left = finalSize.Width - trailingWidth;
        foreach (var child in trailing)
        {
            child.Arrange(new Rect(left, (finalSize.Height - child.DesiredSize.Height) / 2, child.DesiredSize.Width, child.DesiredSize.Height));
            left += child.DesiredSize.Width + Spacing;
        }
        return finalSize;
    }
}
