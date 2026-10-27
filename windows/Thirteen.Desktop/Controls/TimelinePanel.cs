using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Controls;

/// <summary>The column geometry the timeline's rows share (headers, the all-day row, the column bodies): weighted widths.</summary>
public static class TimelineGeometry
{
    /// <summary>The left edge of each column and the right edge of the last (weights: 1 for a day, 0.6 for an intercalary day in Week).</summary>
    public static double[] Edges(IReadOnlyList<double>? weights, int count, double width)
    {
        var w = weights is { Count: > 0 } ? weights : Enumerable.Repeat(1.0, Math.Max(1, count)).ToArray();
        var total = w.Sum();
        var edges = new double[w.Count + 1];
        double x = 0;
        for (var i = 0; i < w.Count; i++)
        {
            edges[i] = Math.Round(x);
            x += total <= 0 ? 0 : width * w[i] / total;
        }
        edges[^1] = Math.Round(width);
        return edges;
    }

    /// <summary>The column under <paramref name="x"/> (clamped to the first and last).</summary>
    public static int ColumnAt(IReadOnlyList<double>? weights, int count, double width, double x)
    {
        var edges = Edges(weights, count, width);
        for (var i = 0; i < edges.Length - 1; i++)
        {
            if (x < edges[i + 1]) return i;
        }
        return edges.Length - 2;
    }
}

/// <summary>
/// Lays children out on the weighted columns of a timeline (docs/EVENTS.md §2.5): the headers and column bodies (lane -1)
/// fill their column at full height; the bars and "+N more" of the all-day row (<see cref="ITimelinePlacement.Lane"/> 0
/// and up) sit in their lane across their columns. An intercalary column is 60 % as wide as a day (Week).
/// </summary>
public sealed class TimelineColumnsPanel : Panel
{
    /// <summary>The columns' relative widths.</summary>
    public static readonly StyledProperty<IReadOnlyList<double>?> WeightsProperty =
        AvaloniaProperty.Register<TimelineColumnsPanel, IReadOnlyList<double>?>(nameof(Weights));

    /// <summary>The height of a lane (all-day row).</summary>
    public static readonly StyledProperty<double> LaneHeightProperty =
        AvaloniaProperty.Register<TimelineColumnsPanel, double>(nameof(LaneHeight), 22);

    static TimelineColumnsPanel()
    {
        AffectsMeasure<TimelineColumnsPanel>(WeightsProperty, LaneHeightProperty);
        AffectsArrange<TimelineColumnsPanel>(WeightsProperty, LaneHeightProperty);
    }

    /// <inheritdoc cref="WeightsProperty"/>
    public IReadOnlyList<double>? Weights { get => GetValue(WeightsProperty); set => SetValue(WeightsProperty, value); }

    /// <inheritdoc cref="LaneHeightProperty"/>
    public double LaneHeight { get => GetValue(LaneHeightProperty); set => SetValue(LaneHeightProperty, value); }

    /// <summary>The gap between a bar and its column's sides.</summary>
    public const double Inset = 2;

    private int ColumnCount => Weights?.Count is > 0 and var n ? n : Math.Max(1, Children.Select(c => (c.DataContext as ITimelinePlacement)?.Column + 1 ?? 0).DefaultIfEmpty(1).Max());

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        // As tall as the tallest column-filling child (a header, a column body) or the lanes, never the space offered.
        var width = double.IsInfinity(availableSize.Width) ? 7 * 120 : availableSize.Width;
        var lanes = 0;
        double tallest = 0;
        foreach (var child in Children)
        {
            if (child.DataContext is not ITimelinePlacement p) continue;
            if (p.Lane >= 0)
            {
                lanes = Math.Max(lanes, p.Lane + 1);
                child.Measure(Slot(child, width, 0).Size);
            }
            else
            {
                child.Measure(new Size(Slot(child, width, 0).Width, availableSize.Height));
                tallest = Math.Max(tallest, child.DesiredSize.Height);
            }
        }
        return new Size(width, Math.Max(tallest, lanes > 0 ? lanes * LaneHeight + 4 : 0));
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        foreach (var child in Children) child.Arrange(Slot(child, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    private Rect Slot(Control child, double width, double height)
    {
        if (child.DataContext is not ITimelinePlacement p) return new Rect(0, 0, 0, 0);
        var edges = TimelineGeometry.Edges(Weights, ColumnCount, width);
        var first = Math.Clamp(p.Column, 0, edges.Length - 2);
        var last = Math.Clamp(p.Column + p.ColumnSpan, first + 1, edges.Length - 1);
        var x = edges[first];
        var right = edges[last];
        if (p.Lane < 0) return new Rect(x, 0, Math.Max(0, right - x), height);
        return new Rect(x + Inset, 2 + p.Lane * LaneHeight + 1, Math.Max(0, right - x - 2 * Inset), Math.Max(0, LaneHeight - 2));
    }
}

/// <summary>
/// Lays out the blocks and "+{n}" blocks of one timeline column (docs/EVENTS.md §2.5) by minute and slot, at least 15
/// minutes tall. It is the column's accessibility container: a <c>Group</c> named for its day (§2.20), holding its
/// blocks in start order. Its grid, tint and now line are drawn behind it by <see cref="TimelineDayGrid"/>.
/// </summary>
public sealed class TimelineDayPanel : Panel
{
    /// <summary>One hour's height.</summary>
    public static readonly StyledProperty<double> HourHeightProperty = AvaloniaProperty.Register<TimelineDayPanel, double>(nameof(HourHeight), 48);

    /// <summary>The gap between blocks and the column's sides, and between blocks side by side.</summary>
    public const double Inset = 3;

    static TimelineDayPanel()
    {
        AffectsMeasure<TimelineDayPanel>(HourHeightProperty);
        AffectsArrange<TimelineDayPanel>(HourHeightProperty);
    }

    /// <inheritdoc cref="HourHeightProperty"/>
    public double HourHeight { get => GetValue(HourHeightProperty); set => SetValue(HourHeightProperty, value); }

    /// <summary>The y of a minute.</summary>
    public double YOf(double minute) => minute * HourHeight / 60;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var width = double.IsInfinity(availableSize.Width) ? 120 : availableSize.Width;
        var height = HourHeight * 24;
        foreach (var child in Children) child.Measure(Slot(child, width).Size);
        return new Size(width, height);
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        foreach (var child in Children) child.Arrange(Slot(child, finalSize.Width));
        return finalSize;
    }

    /// <summary>Where a block or "+{n}" block goes: x = slot x width / slots, y by minutes, at least 15 minutes tall.</summary>
    public Rect Slot(Control child, double width)
    {
        ArgumentNullException.ThrowIfNull(child);
        (int start, int end, int slot, int count) = child.DataContext switch
        {
            TimelineBlock b => (b.StartMinute, b.VisualEndMinute, b.Slot, b.SlotCount),
            TimelineOverflow o => (o.StartMinute, o.VisualEndMinute, o.Slot, o.SlotCount),
            _ => (0, 0, 0, 1),
        };
        if (end <= start) return new Rect(0, 0, 0, 0);
        var inner = Math.Max(0, width - Inset);
        var slotWidth = inner / Math.Max(1, count);
        var x = Inset + slot * slotWidth;
        var top = YOf(start) + 1;
        var height = Math.Max(4, YOf(end) - YOf(start) - 2);
        return new Rect(x, top, Math.Max(0, slotWidth - Inset), height);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ColumnPeer(this);

    /// <summary>The column container: a <c>Group</c> with the column's name (§2.20 "Grouping").</summary>
    private sealed class ColumnPeer(TimelineDayPanel owner) : ControlAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override bool IsControlElementCore() => true;

        protected override bool IsContentElementCore() => true;
    }
}

/// <summary>
/// What is drawn behind a timeline column (board F1): the hour rules and half-hour hairlines, today's 5 % accent tint,
/// the intercalary hatch, and the now line under the blocks (2 px accent in today's column, faint in the others), so it
/// never strikes through a title.
/// </summary>
public sealed class TimelineDayGrid : Control
{
    /// <summary>One hour's height.</summary>
    public static readonly StyledProperty<double> HourHeightProperty = AvaloniaProperty.Register<TimelineDayGrid, double>(nameof(HourHeight), 48);

    /// <summary>Today's column (tinted; its now line at full strength).</summary>
    public static readonly StyledProperty<bool> IsTodayProperty = AvaloniaProperty.Register<TimelineDayGrid, bool>(nameof(IsToday));

    /// <summary>An intercalary day (hatched).</summary>
    public static readonly StyledProperty<bool> IsIntercalaryProperty = AvaloniaProperty.Register<TimelineDayGrid, bool>(nameof(IsIntercalary));

    /// <summary>The now line's minute, or null.</summary>
    public static readonly StyledProperty<int?> NowMinuteProperty = AvaloniaProperty.Register<TimelineDayGrid, int?>(nameof(NowMinute));

    /// <summary><c>rule</c> (hour rules, the column's left edge).</summary>
    public static readonly StyledProperty<Color> RuleColorProperty = AvaloniaProperty.Register<TimelineDayGrid, Color>(nameof(RuleColor), Colors.LightGray);

    /// <summary><c>rule-soft</c> (half-hour hairlines).</summary>
    public static readonly StyledProperty<Color> RuleSoftColorProperty = AvaloniaProperty.Register<TimelineDayGrid, Color>(nameof(RuleSoftColor), Colors.Gainsboro);

    /// <summary><c>accent</c> (the now line, today's tint).</summary>
    public static readonly StyledProperty<Color> AccentColorProperty = AvaloniaProperty.Register<TimelineDayGrid, Color>(nameof(AccentColor), Colors.OrangeRed);

    /// <summary>
    /// A Windows contrast theme is on (§2.20): no today tint and no hatch, and the now line solid <c>Highlight</c> (the
    /// accent there) in every column, 2 px in today's.
    /// </summary>
    public static readonly StyledProperty<bool> HighContrastProperty = AvaloniaProperty.Register<TimelineDayGrid, bool>(nameof(HighContrast));

    static TimelineDayGrid()
    {
        AffectsMeasure<TimelineDayGrid>(HourHeightProperty);
        AffectsRender<TimelineDayGrid>(HourHeightProperty, IsTodayProperty, IsIntercalaryProperty, NowMinuteProperty, RuleColorProperty, RuleSoftColorProperty, AccentColorProperty,
            HighContrastProperty);
        IsHitTestVisibleProperty.OverrideDefaultValue<TimelineDayGrid>(false);
    }

    /// <inheritdoc cref="HourHeightProperty"/>
    public double HourHeight { get => GetValue(HourHeightProperty); set => SetValue(HourHeightProperty, value); }

    /// <inheritdoc cref="IsTodayProperty"/>
    public bool IsToday { get => GetValue(IsTodayProperty); set => SetValue(IsTodayProperty, value); }

    /// <inheritdoc cref="IsIntercalaryProperty"/>
    public bool IsIntercalary { get => GetValue(IsIntercalaryProperty); set => SetValue(IsIntercalaryProperty, value); }

    /// <inheritdoc cref="NowMinuteProperty"/>
    public int? NowMinute { get => GetValue(NowMinuteProperty); set => SetValue(NowMinuteProperty, value); }

    /// <inheritdoc cref="RuleColorProperty"/>
    public Color RuleColor { get => GetValue(RuleColorProperty); set => SetValue(RuleColorProperty, value); }

    /// <inheritdoc cref="RuleSoftColorProperty"/>
    public Color RuleSoftColor { get => GetValue(RuleSoftColorProperty); set => SetValue(RuleSoftColorProperty, value); }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor { get => GetValue(AccentColorProperty); set => SetValue(AccentColorProperty, value); }

    /// <inheritdoc cref="HighContrastProperty"/>
    public bool HighContrast { get => GetValue(HighContrastProperty); set => SetValue(HighContrastProperty, value); }

    /// <summary>The y of a minute.</summary>
    public double YOf(double minute) => minute * HourHeight / 60;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize) => new(double.IsInfinity(availableSize.Width) ? 120 : availableSize.Width, HourHeight * 24);

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        var contrast = HighContrast;
        if (IsToday && !contrast) context.FillRectangle(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(AccentColor, 0.05)), bounds);
        if (IsIntercalary && !contrast)
        {
            // The intercalary hatch (§2.2), cut to the column by hand (no PushClip, see EventChip.cs).
            var pen = new ImmutablePen(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(AccentColor, 0.12)), 1);
            var h = bounds.Height;
            for (var d = -h; d < bounds.Width; d += 9)
            {
                var x0 = Math.Max(d, 0);
                var x1 = Math.Min(d + h, bounds.Width);
                if (x1 > x0) context.DrawLine(pen, new Point(x0, h - (x0 - d)), new Point(x1, h - (x1 - d)));
            }
        }
        var rule = new ImmutablePen(new ImmutableSolidColorBrush(RuleColor), 1);
        var soft = new ImmutablePen(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(RuleSoftColor, 0.7)), 1, new ImmutableDashStyle([2, 3], 0));
        for (var hour = 0; hour < 24; hour++)
        {
            var y = Math.Round(YOf(hour * 60)) + 0.5;
            if (hour > 0) context.DrawLine(rule, new Point(0, y), new Point(bounds.Width, y));
            var half = Math.Round(YOf(hour * 60 + 30)) + 0.5;
            context.DrawLine(soft, new Point(0, half), new Point(bounds.Width, half));
        }
        context.DrawLine(rule, new Point(0.5, 0), new Point(0.5, bounds.Height));
        if (NowMinute is { } now)
        {
            var y = Math.Round(YOf(now)) + 0.5;
            var pen = IsToday ? new ImmutablePen(new ImmutableSolidColorBrush(AccentColor), 2)
                : new ImmutablePen(new ImmutableSolidColorBrush(contrast ? AccentColor : ThemeResources.WithAlpha(AccentColor, 0.45)), 1);
            context.DrawLine(pen, new Point(0, y), new Point(bounds.Width, y));
        }
    }
}

/// <summary>
/// The time axis of a timeline (§2.5): hour labels in Geist Mono in the OS form ("09:00", "9 AM") right-aligned in the
/// label column, and the now label with its dot on the axis when the timeline shows today (board F1). Drawn, so it is
/// hidden from assistive tech: the block labels carry the time (§2.20 "Timeline").
/// </summary>
public sealed class TimelineHours : Control
{
    /// <summary>One hour's height.</summary>
    public static readonly StyledProperty<double> HourHeightProperty = AvaloniaProperty.Register<TimelineHours, double>(nameof(HourHeight), 48);

    /// <summary>The labels, hour 0 to 23 (hour 0 is not drawn: it sits on the top edge).</summary>
    public static readonly StyledProperty<IReadOnlyList<string>?> LabelsProperty = AvaloniaProperty.Register<TimelineHours, IReadOnlyList<string>?>(nameof(Labels));

    /// <summary>The now minute, or null.</summary>
    public static readonly StyledProperty<int?> NowMinuteProperty = AvaloniaProperty.Register<TimelineHours, int?>(nameof(NowMinute));

    /// <summary>The now label ("09:41").</summary>
    public static readonly StyledProperty<string?> NowTextProperty = AvaloniaProperty.Register<TimelineHours, string?>(nameof(NowText));

    /// <summary>Label size.</summary>
    public static readonly StyledProperty<double> TextSizeProperty = AvaloniaProperty.Register<TimelineHours, double>(nameof(TextSize), 10.5);

    /// <summary><c>ink-3</c>.</summary>
    public static readonly StyledProperty<Color> InkColorProperty = AvaloniaProperty.Register<TimelineHours, Color>(nameof(InkColor), Colors.Gray);

    /// <summary><c>accent</c> / <c>accent-text</c> (the now label and dot).</summary>
    public static readonly StyledProperty<Color> AccentColorProperty = AvaloniaProperty.Register<TimelineHours, Color>(nameof(AccentColor), Colors.OrangeRed);

    static TimelineHours()
    {
        AffectsMeasure<TimelineHours>(HourHeightProperty);
        AffectsRender<TimelineHours>(HourHeightProperty, LabelsProperty, NowMinuteProperty, NowTextProperty, TextSizeProperty, InkColorProperty, AccentColorProperty);
        IsHitTestVisibleProperty.OverrideDefaultValue<TimelineHours>(false);
    }

    /// <inheritdoc cref="HourHeightProperty"/>
    public double HourHeight { get => GetValue(HourHeightProperty); set => SetValue(HourHeightProperty, value); }

    /// <inheritdoc cref="LabelsProperty"/>
    public IReadOnlyList<string>? Labels { get => GetValue(LabelsProperty); set => SetValue(LabelsProperty, value); }

    /// <inheritdoc cref="NowMinuteProperty"/>
    public int? NowMinute { get => GetValue(NowMinuteProperty); set => SetValue(NowMinuteProperty, value); }

    /// <inheritdoc cref="NowTextProperty"/>
    public string? NowText { get => GetValue(NowTextProperty); set => SetValue(NowTextProperty, value); }

    /// <inheritdoc cref="TextSizeProperty"/>
    public double TextSize { get => GetValue(TextSizeProperty); set => SetValue(TextSizeProperty, value); }

    /// <inheritdoc cref="InkColorProperty"/>
    public Color InkColor { get => GetValue(InkColorProperty); set => SetValue(InkColorProperty, value); }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor { get => GetValue(AccentColorProperty); set => SetValue(AccentColorProperty, value); }

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize) => new(double.IsInfinity(availableSize.Width) ? 56 : availableSize.Width, HourHeight * 24);

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var width = Bounds.Width;
        var labels = Labels;
        var nowY = NowMinute is { } now ? now * HourHeight / 60 : (double?)null;
        if (labels is not null)
        {
            var brush = new ImmutableSolidColorBrush(InkColor);
            for (var hour = 1; hour < Math.Min(24, labels.Count); hour++)
            {
                var y = hour * HourHeight;
                // A label the now label would cover is left out (board J1).
                if (nowY is { } n && Math.Abs(n - y) < TextSize * 1.3) continue;
                var text = AppFonts.Text(labels[hour], AppFonts.Mono, TextSize, FontWeight.Regular, brush);
                context.DrawText(text, new Point(width - 8 - text.Width, y - text.Height / 2));
            }
        }
        if (nowY is { } ny && NowText is { Length: > 0 } nowText)
        {
            var accent = new ImmutableSolidColorBrush(AccentColor);
            var text = AppFonts.Text(nowText, AppFonts.Mono, TextSize, FontWeight.SemiBold, accent);
            context.DrawText(text, new Point(width - 9 - text.Width, ny - text.Height / 2));
            context.DrawEllipse(accent, null, new Point(width, ny), 5, 5);
        }
    }
}

/// <summary>
/// A timeline block as board F1 draws it: the calendar color at 16 % over <c>paper-raised</c> (24 % on dark themes), a
/// 3 px edge in the color and a 1 px ring of it at 30 %, the title in <c>ink</c> (semibold) and the time range in Geist
/// Mono <c>ink-2</c> under it, the location under that when there is room; a short block puts the title and the start on
/// one line. Tentative events get the 8 % hatch, canceled ones a struck-through title in <c>ink-2</c>. The control is the
/// visual only; its Button (Views/Calendar) gives focus, clicks and the accessible name.
/// </summary>
public sealed class TimelineBlockVisual : Control
{
    /// <summary>The calendar color.</summary>
    public static readonly StyledProperty<Color> EventColorProperty = AvaloniaProperty.Register<TimelineBlockVisual, Color>(nameof(EventColor), Colors.Gray);

    /// <summary>The title (user text).</summary>
    public static readonly StyledProperty<string?> TitleProperty = AvaloniaProperty.Register<TimelineBlockVisual, string?>(nameof(Title));

    /// <summary>"09:30 to 10:30".</summary>
    public static readonly StyledProperty<string?> TimeTextProperty = AvaloniaProperty.Register<TimelineBlockVisual, string?>(nameof(TimeText));

    /// <summary>"09:30" (a short block's start).</summary>
    public static readonly StyledProperty<string?> StartTextProperty = AvaloniaProperty.Register<TimelineBlockVisual, string?>(nameof(StartText));

    /// <summary>The location (user text).</summary>
    public static readonly StyledProperty<string?> LocationProperty = AvaloniaProperty.Register<TimelineBlockVisual, string?>(nameof(Location));

    /// <summary>Tentative.</summary>
    public static readonly StyledProperty<bool> IsTentativeProperty = AvaloniaProperty.Register<TimelineBlockVisual, bool>(nameof(IsTentative));

    /// <summary>Canceled.</summary>
    public static readonly StyledProperty<bool> IsCanceledProperty = AvaloniaProperty.Register<TimelineBlockVisual, bool>(nameof(IsCanceled));

    /// <summary>Selected (an ink outline).</summary>
    public static readonly StyledProperty<bool> IsSelectedProperty = AvaloniaProperty.Register<TimelineBlockVisual, bool>(nameof(IsSelected));

    /// <summary>A draft or drag preview (accent wash with an accent ring, board C4).</summary>
    public static readonly StyledProperty<bool> IsDraftProperty = AvaloniaProperty.Register<TimelineBlockVisual, bool>(nameof(IsDraft));

    /// <summary><c>paper-raised</c>.</summary>
    public static readonly StyledProperty<Color> SurfaceColorProperty = AvaloniaProperty.Register<TimelineBlockVisual, Color>(nameof(SurfaceColor), Colors.White);

    /// <summary><c>ink</c>.</summary>
    public static readonly StyledProperty<Color> InkColorProperty = AvaloniaProperty.Register<TimelineBlockVisual, Color>(nameof(InkColor), Colors.Black);

    /// <summary><c>ink-2</c>.</summary>
    public static readonly StyledProperty<Color> Ink2ColorProperty = AvaloniaProperty.Register<TimelineBlockVisual, Color>(nameof(Ink2Color), Colors.DimGray);

    /// <summary><c>accent</c> (drafts).</summary>
    public static readonly StyledProperty<Color> AccentColorProperty = AvaloniaProperty.Register<TimelineBlockVisual, Color>(nameof(AccentColor), Colors.OrangeRed);

    /// <summary>Title size (11 at 100 % text).</summary>
    public static readonly StyledProperty<double> TextSizeProperty = AvaloniaProperty.Register<TimelineBlockVisual, double>(nameof(TextSize), 11);

    /// <summary>
    /// A Windows contrast theme is on (§2.20, the web's forced-colors rules): <c>Canvas</c> with a 1 px <c>CanvasText</c>
    /// border (dashed when tentative), no tint, colored edge or hatch, and a 2 px <c>Highlight</c> outline when selected.
    /// </summary>
    public static readonly StyledProperty<bool> HighContrastProperty = AvaloniaProperty.Register<TimelineBlockVisual, bool>(nameof(HighContrast));

    private const double Radius = 6;

    static TimelineBlockVisual()
    {
        AffectsRender<TimelineBlockVisual>(EventColorProperty, TitleProperty, TimeTextProperty, StartTextProperty, LocationProperty, IsTentativeProperty,
            IsCanceledProperty, IsSelectedProperty, IsDraftProperty, SurfaceColorProperty, InkColorProperty, Ink2ColorProperty, AccentColorProperty, TextSizeProperty,
            HighContrastProperty);
    }

    /// <inheritdoc cref="HighContrastProperty"/>
    public bool HighContrast { get => GetValue(HighContrastProperty); set => SetValue(HighContrastProperty, value); }

    /// <inheritdoc cref="EventColorProperty"/>
    public Color EventColor { get => GetValue(EventColorProperty); set => SetValue(EventColorProperty, value); }

    /// <inheritdoc cref="TitleProperty"/>
    public string? Title { get => GetValue(TitleProperty); set => SetValue(TitleProperty, value); }

    /// <inheritdoc cref="TimeTextProperty"/>
    public string? TimeText { get => GetValue(TimeTextProperty); set => SetValue(TimeTextProperty, value); }

    /// <inheritdoc cref="StartTextProperty"/>
    public string? StartText { get => GetValue(StartTextProperty); set => SetValue(StartTextProperty, value); }

    /// <inheritdoc cref="LocationProperty"/>
    public string? Location { get => GetValue(LocationProperty); set => SetValue(LocationProperty, value); }

    /// <inheritdoc cref="IsTentativeProperty"/>
    public bool IsTentative { get => GetValue(IsTentativeProperty); set => SetValue(IsTentativeProperty, value); }

    /// <inheritdoc cref="IsCanceledProperty"/>
    public bool IsCanceled { get => GetValue(IsCanceledProperty); set => SetValue(IsCanceledProperty, value); }

    /// <inheritdoc cref="IsSelectedProperty"/>
    public bool IsSelected { get => GetValue(IsSelectedProperty); set => SetValue(IsSelectedProperty, value); }

    /// <inheritdoc cref="IsDraftProperty"/>
    public bool IsDraft { get => GetValue(IsDraftProperty); set => SetValue(IsDraftProperty, value); }

    /// <inheritdoc cref="SurfaceColorProperty"/>
    public Color SurfaceColor { get => GetValue(SurfaceColorProperty); set => SetValue(SurfaceColorProperty, value); }

    /// <inheritdoc cref="InkColorProperty"/>
    public Color InkColor { get => GetValue(InkColorProperty); set => SetValue(InkColorProperty, value); }

    /// <inheritdoc cref="Ink2ColorProperty"/>
    public Color Ink2Color { get => GetValue(Ink2ColorProperty); set => SetValue(Ink2ColorProperty, value); }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor { get => GetValue(AccentColorProperty); set => SetValue(AccentColorProperty, value); }

    /// <inheritdoc cref="TextSizeProperty"/>
    public double TextSize { get => GetValue(TextSizeProperty); set => SetValue(TextSizeProperty, value); }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);
        if (bounds.Width <= 2 || bounds.Height <= 2) return;
        var contrast = HighContrast;
        var color = IsDraft ? AccentColor : EventColor;
        var fill = IsDraft ? ThemeResources.WithAlpha(AccentColor, 0.16) : EventChipVisual.BarFill(color, SurfaceColor);
        var shape = new RectangleGeometry(contrast ? bounds.Deflate(0.5) : bounds, Radius, Radius);
        if (contrast) context.DrawGeometry(new ImmutableSolidColorBrush(SurfaceColor), EventChipVisual.ContrastPen(InkColor, IsTentative), shape);
        else context.DrawGeometry(new ImmutableSolidColorBrush(fill), new ImmutablePen(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(color, IsDraft ? 1 : 0.3)), IsDraft ? 1.5 : 1), shape);
        if (!IsDraft && !contrast)
        {
            var edge = new CombinedGeometry(GeometryCombineMode.Intersect, shape, new RectangleGeometry(new Rect(0, 0, 3, bounds.Height)));
            context.DrawGeometry(new ImmutableSolidColorBrush(color), null, edge);
        }
        if (IsTentative && !contrast)
        {
            var pen = new ImmutablePen(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(InkColor, 0.08)), 1.5);
            var h = bounds.Height;
            for (var d = -h; d < bounds.Width; d += 5)
            {
                var x0 = Math.Max(d, 0);
                var x1 = Math.Min(d + h, bounds.Width);
                if (x1 > x0) context.DrawLine(pen, new Point(x0, h - (x0 - d)), new Point(x1, h - (x1 - d)));
            }
        }

        var titleBrush = new ImmutableSolidColorBrush(IsDraft && !contrast ? AccentColor : IsCanceled ? Ink2Color : InkColor);
        var subBrush = new ImmutableSolidColorBrush(Ink2Color);
        var left = IsDraft ? 6 : 8;
        var right = bounds.Width - 5;
        var room = right - left;
        if (room <= 4) return;
        var titleSize = TextSize + 0.5;
        var lineHeight = Math.Ceiling(titleSize * 1.3);
        var shortBlock = bounds.Height < lineHeight * 2 + 4;
        var top = shortBlock ? Math.Max(1, (bounds.Height - lineHeight) / 2) : 4;
        var title = AppFonts.Text(Title ?? "", AppFonts.Sans, titleSize, FontWeight.SemiBold, titleBrush);
        if (shortBlock)
        {
            // One line: the title, then the start time (board F1 ".blk.short").
            var start = string.IsNullOrEmpty(StartText) ? null : AppFonts.Text(StartText!, AppFonts.Mono, TextSize - 1, FontWeight.Regular, subBrush);
            var titleRoom = room - (start is null ? 0 : Math.Min(start.Width + 6, room / 2));
            title.MaxTextWidth = Math.Max(1, titleRoom);
            title.MaxLineCount = 1;
            title.Trimming = TextTrimming.CharacterEllipsis;
            context.DrawText(title, new Point(left, top));
            Strike(context, title, left, top, titleBrush);
            if (start is not null && left + title.WidthIncludingTrailingWhitespace + 6 + start.Width <= right)
            {
                context.DrawText(start, new Point(left + title.WidthIncludingTrailingWhitespace + 6, top + (title.Height - start.Height) / 2));
            }
            return;
        }
        title.MaxTextWidth = room;
        title.MaxLineCount = bounds.Height > lineHeight * 4 ? 2 : 1;
        title.Trimming = TextTrimming.CharacterEllipsis;
        context.DrawText(title, new Point(left, top));
        Strike(context, title, left, top, titleBrush);
        var y = top + title.Height + 1;
        if (!string.IsNullOrEmpty(TimeText) && y + lineHeight * 0.8 <= bounds.Height)
        {
            var time = AppFonts.Text(TimeText!, AppFonts.Mono, TextSize - 1, FontWeight.Regular, subBrush);
            time.MaxTextWidth = room;
            time.MaxLineCount = 1;
            time.Trimming = TextTrimming.CharacterEllipsis;
            context.DrawText(time, new Point(left, y));
            y += time.Height + 1;
        }
        if (!string.IsNullOrEmpty(Location) && y + lineHeight * 0.8 <= bounds.Height)
        {
            var location = AppFonts.Text(Location!, AppFonts.Sans, TextSize - 0.5, FontWeight.Regular, subBrush);
            location.MaxTextWidth = room;
            location.MaxLineCount = 1;
            location.Trimming = TextTrimming.CharacterEllipsis;
            context.DrawText(location, new Point(left, y));
        }
        if (IsSelected)
        {
            var pen = contrast ? new ImmutablePen(new ImmutableSolidColorBrush(AccentColor), 2) : new ImmutablePen(new ImmutableSolidColorBrush(InkColor), 1.5);
            context.DrawRectangle(null, pen, bounds.Deflate(contrast ? 1 : 0.75), Radius, Radius);
        }
    }

    private void Strike(DrawingContext context, FormattedText title, double x, double top, ImmutableSolidColorBrush brush)
    {
        if (!IsCanceled) return;
        var y = Math.Round(top + title.Height * 0.55) + 0.5;
        context.DrawLine(new ImmutablePen(brush, 1), new Point(x, y), new Point(x + title.WidthIncludingTrailingWhitespace, y));
    }
}

/// <summary>
/// The rules between the columns of a timeline row (the header row, the all-day row), the intercalary hatch, and the
/// drop target of a drag over the all-day row (an accent wash over the columns the bar would cover).
/// </summary>
public sealed class TimelineColumnRules : Control
{
    /// <summary>The columns' relative widths.</summary>
    public static readonly StyledProperty<IReadOnlyList<double>?> WeightsProperty =
        AvaloniaProperty.Register<TimelineColumnRules, IReadOnlyList<double>?>(nameof(Weights));

    /// <summary>Which columns are hatched (intercalary days).</summary>
    public static readonly StyledProperty<IReadOnlyList<bool>?> HatchedProperty =
        AvaloniaProperty.Register<TimelineColumnRules, IReadOnlyList<bool>?>(nameof(Hatched));

    /// <summary>The first column of the drop target, or -1.</summary>
    public static readonly StyledProperty<int> HighlightFromProperty = AvaloniaProperty.Register<TimelineColumnRules, int>(nameof(HighlightFrom), -1);

    /// <summary>The last column of the drop target.</summary>
    public static readonly StyledProperty<int> HighlightToProperty = AvaloniaProperty.Register<TimelineColumnRules, int>(nameof(HighlightTo), -1);

    /// <summary><c>rule</c>.</summary>
    public static readonly StyledProperty<Color> RuleColorProperty = AvaloniaProperty.Register<TimelineColumnRules, Color>(nameof(RuleColor), Colors.LightGray);

    /// <summary><c>accent</c>.</summary>
    public static readonly StyledProperty<Color> AccentColorProperty = AvaloniaProperty.Register<TimelineColumnRules, Color>(nameof(AccentColor), Colors.OrangeRed);

    /// <summary>A Windows contrast theme is on (§2.20): no hatch, and the drop target a <c>Highlight</c> frame without a wash.</summary>
    public static readonly StyledProperty<bool> HighContrastProperty = AvaloniaProperty.Register<TimelineColumnRules, bool>(nameof(HighContrast));

    /// <inheritdoc cref="HighContrastProperty"/>
    public bool HighContrast { get => GetValue(HighContrastProperty); set => SetValue(HighContrastProperty, value); }

    static TimelineColumnRules()
    {
        AffectsRender<TimelineColumnRules>(WeightsProperty, HatchedProperty, HighlightFromProperty, HighlightToProperty, RuleColorProperty, AccentColorProperty,
            HighContrastProperty);
        IsHitTestVisibleProperty.OverrideDefaultValue<TimelineColumnRules>(false);
    }

    /// <inheritdoc cref="WeightsProperty"/>
    public IReadOnlyList<double>? Weights { get => GetValue(WeightsProperty); set => SetValue(WeightsProperty, value); }

    /// <inheritdoc cref="HatchedProperty"/>
    public IReadOnlyList<bool>? Hatched { get => GetValue(HatchedProperty); set => SetValue(HatchedProperty, value); }

    /// <inheritdoc cref="HighlightFromProperty"/>
    public int HighlightFrom { get => GetValue(HighlightFromProperty); set => SetValue(HighlightFromProperty, value); }

    /// <inheritdoc cref="HighlightToProperty"/>
    public int HighlightTo { get => GetValue(HighlightToProperty); set => SetValue(HighlightToProperty, value); }

    /// <inheritdoc cref="RuleColorProperty"/>
    public Color RuleColor { get => GetValue(RuleColorProperty); set => SetValue(RuleColorProperty, value); }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor { get => GetValue(AccentColorProperty); set => SetValue(AccentColorProperty, value); }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        var weights = Weights;
        var count = weights?.Count ?? 1;
        var edges = TimelineGeometry.Edges(weights, count, bounds.Width);
        var hatched = Hatched;
        if (hatched is not null && !HighContrast)
        {
            var pen = new ImmutablePen(new ImmutableSolidColorBrush(ThemeResources.WithAlpha(AccentColor, 0.12)), 1);
            for (var c = 0; c < Math.Min(hatched.Count, edges.Length - 1); c++)
            {
                if (!hatched[c]) continue;
                double left = edges[c], right = edges[c + 1], h = bounds.Height;
                for (var d = left - h; d < right; d += 9)
                {
                    var x0 = Math.Max(d, left);
                    var x1 = Math.Min(d + h, right);
                    if (x1 > x0) context.DrawLine(pen, new Point(x0, h - (x0 - d)), new Point(x1, h - (x1 - d)));
                }
            }
        }
        if (HighlightFrom >= 0 && HighlightTo >= HighlightFrom)
        {
            var from = Math.Clamp(HighlightFrom, 0, edges.Length - 2);
            var to = Math.Clamp(HighlightTo, from, edges.Length - 2);
            var rect = new Rect(edges[from] + 1, 1, Math.Max(0, edges[to + 1] - edges[from] - 2), Math.Max(0, bounds.Height - 2));
            context.DrawRectangle(HighContrast ? null : new ImmutableSolidColorBrush(ThemeResources.WithAlpha(AccentColor, 0.14)),
                new ImmutablePen(new ImmutableSolidColorBrush(AccentColor), HighContrast ? 2 : 1.5), rect, 4, 4);
        }
        var rule = new ImmutablePen(new ImmutableSolidColorBrush(RuleColor), 1);
        for (var c = 0; c < edges.Length - 1; c++) context.DrawLine(rule, new Point(edges[c] + 0.5, 0), new Point(edges[c] + 0.5, bounds.Height));
    }
}
