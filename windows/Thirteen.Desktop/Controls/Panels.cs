using Avalonia;
using Avalonia.Controls;

namespace Thirteen.Desktop.Controls;

/// <summary>
/// The column a page sits in: as wide as the window allows, up to <see cref="MaxContentWidth"/> (not counting
/// the child's margin), and left-aligned under the page title like the pages of Windows 11 Settings. A plain
/// MaxWidth would centre the content instead and leave the title and the header's commands at the window's
/// edges on wide screens. The window's header uses the same column, so their edges line up.
/// </summary>
public sealed class PageColumn : Decorator
{
    /// <summary>The widest the child's content box gets.</summary>
    public static readonly StyledProperty<double> MaxContentWidthProperty =
        AvaloniaProperty.Register<PageColumn, double>(nameof(MaxContentWidth), double.PositiveInfinity);

    static PageColumn()
    {
        AffectsMeasure<PageColumn>(MaxContentWidthProperty);
    }

    /// <inheritdoc cref="MaxContentWidthProperty"/>
    public double MaxContentWidth
    {
        get => GetValue(MaxContentWidthProperty);
        set => SetValue(MaxContentWidthProperty, value);
    }

    private double Cap(double width)
    {
        if (Child is not { } child || double.IsNaN(MaxContentWidth)) return width;
        var margin = child.Margin;
        return Math.Min(width, MaxContentWidth + margin.Left + margin.Right);
    }

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        if (Child is not { } child) return default;
        child.Measure(availableSize.WithWidth(Cap(availableSize.Width)));
        return child.DesiredSize;
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        Child?.Arrange(new Rect(0, 0, Cap(finalSize.Width), finalSize.Height));
        return finalSize;
    }
}

/// <summary>
/// A responsive two-column page layout. When the panel is at least <see cref="Threshold"/> wide, children
/// go to the column given by the attached <c>Column</c> (0 or 1, stacked in child order); otherwise every
/// child is stacked in one column, ordered by the attached <c>Order</c> (child order when unset). The
/// screens' wide (two-column) and narrow (one-column) layouts.
/// </summary>
public sealed class SplitColumns : Panel
{
    /// <summary>Width at which the columns sit side by side.</summary>
    public static readonly StyledProperty<double> ThresholdProperty =
        AvaloniaProperty.Register<SplitColumns, double>(nameof(Threshold), 760);

    /// <summary>Gap between columns and between stacked children.</summary>
    public static readonly StyledProperty<double> SpacingProperty =
        AvaloniaProperty.Register<SplitColumns, double>(nameof(Spacing), 16);

    /// <summary>Relative column widths, e.g. "1,1" or "5,4" (equal when unset).</summary>
    public static readonly StyledProperty<string?> RatiosProperty =
        AvaloniaProperty.Register<SplitColumns, string?>(nameof(Ratios));

    /// <summary>The column of a child in the wide layout.</summary>
    public static readonly AttachedProperty<int> ColumnProperty =
        AvaloniaProperty.RegisterAttached<SplitColumns, Control, int>("Column");

    /// <summary>The position of a child in the narrow (stacked) layout; -1 keeps child order.</summary>
    public static readonly AttachedProperty<int> OrderProperty =
        AvaloniaProperty.RegisterAttached<SplitColumns, Control, int>("Order", -1);

    static SplitColumns()
    {
        AffectsMeasure<SplitColumns>(ThresholdProperty, SpacingProperty, RatiosProperty);
        AffectsParentMeasure<SplitColumns>(ColumnProperty, OrderProperty);
    }

    /// <summary>Gets the column of a child.</summary>
    public static int GetColumn(Control control) => control.GetValue(ColumnProperty);

    /// <summary>Sets the column of a child.</summary>
    public static void SetColumn(Control control, int value) => control.SetValue(ColumnProperty, value);

    /// <summary>Gets the narrow-layout order of a child.</summary>
    public static int GetOrder(Control control) => control.GetValue(OrderProperty);

    /// <summary>Sets the narrow-layout order of a child.</summary>
    public static void SetOrder(Control control, int value) => control.SetValue(OrderProperty, value);

    /// <inheritdoc cref="ThresholdProperty"/>
    public double Threshold
    {
        get => GetValue(ThresholdProperty);
        set => SetValue(ThresholdProperty, value);
    }

    /// <inheritdoc cref="SpacingProperty"/>
    public double Spacing
    {
        get => GetValue(SpacingProperty);
        set => SetValue(SpacingProperty, value);
    }

    /// <inheritdoc cref="RatiosProperty"/>
    public string? Ratios
    {
        get => GetValue(RatiosProperty);
        set => SetValue(RatiosProperty, value);
    }

    /// <summary>Whether the last layout used two columns.</summary>
    public bool IsWide { get; private set; }

    private double[] _widths = [];

    private Control[] Visible => Children.Where(c => c.IsVisible).ToArray();

    private int ColumnCount(Control[] children) => children.Length == 0 ? 0 : children.Max(c => Math.Max(0, GetColumn(c))) + 1;

    private double[] Widths(double width, int count)
    {
        var ratios = (Ratios ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(r => double.TryParse(r, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 1)
            .ToList();
        while (ratios.Count < count) ratios.Add(1);
        var total = ratios.Take(count).Sum();
        var available = Math.Max(0, width - Spacing * (count - 1));
        return ratios.Take(count).Select(r => available * r / total).ToArray();
    }

    private Control[] Stacked(Control[] children) =>
        children.Select((c, i) => (Child: c, Key: GetOrder(c) >= 0 ? GetOrder(c) : i)).OrderBy(p => p.Key).Select(p => p.Child).ToArray();

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var children = Visible;
        if (children.Length == 0) return default;
        var width = double.IsInfinity(availableSize.Width) ? Threshold : availableSize.Width;
        var columns = ColumnCount(children);
        IsWide = width >= Threshold && columns > 1;
        if (IsWide)
        {
            _widths = Widths(width, columns);
            var heights = new double[columns];
            var counts = new int[columns];
            foreach (var child in children)
            {
                var column = Math.Max(0, GetColumn(child));
                child.Measure(new Size(_widths[column], double.PositiveInfinity));
                heights[column] += child.DesiredSize.Height;
                counts[column]++;
            }
            return new Size(width, Enumerable.Range(0, columns).Max(c => heights[c] + Spacing * Math.Max(0, counts[c] - 1)));
        }
        var total = 0.0;
        foreach (var child in children)
        {
            child.Measure(new Size(width, double.PositiveInfinity));
            total += child.DesiredSize.Height;
        }
        return new Size(width, total + Spacing * (children.Length - 1));
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        var children = Visible;
        if (IsWide)
        {
            var columns = _widths.Length;
            var x = new double[columns];
            for (var c = 1; c < columns; c++) x[c] = x[c - 1] + _widths[c - 1] + Spacing;
            var y = new double[columns];
            foreach (var child in children)
            {
                var column = Math.Max(0, GetColumn(child));
                child.Arrange(new Rect(x[column], y[column], _widths[column], child.DesiredSize.Height));
                y[column] += child.DesiredSize.Height + Spacing;
            }
            return finalSize;
        }
        var top = 0.0;
        foreach (var child in Stacked(children))
        {
            child.Arrange(new Rect(0, top, finalSize.Width, child.DesiredSize.Height));
            top += child.DesiredSize.Height + Spacing;
        }
        return finalSize;
    }
}

/// <summary>
/// Equal-width items in as many columns as fit (at least <see cref="MinItemWidth"/> each, at most
/// <see cref="MaxColumns"/>); items of a row share the row's height. The Year screen's month cards and the
/// card grids of Compare, Convert and History.
/// </summary>
public sealed class CardGrid : Panel
{
    /// <summary>Smallest item width.</summary>
    public static readonly StyledProperty<double> MinItemWidthProperty =
        AvaloniaProperty.Register<CardGrid, double>(nameof(MinItemWidth), 280);

    /// <summary>Most columns.</summary>
    public static readonly StyledProperty<int> MaxColumnsProperty =
        AvaloniaProperty.Register<CardGrid, int>(nameof(MaxColumns), 4);

    /// <summary>Gap between items, both ways.</summary>
    public static readonly StyledProperty<double> SpacingProperty =
        AvaloniaProperty.Register<CardGrid, double>(nameof(Spacing), 16);

    /// <summary>Whether items of a row stretch to the row's height.</summary>
    public static readonly StyledProperty<bool> UniformRowsProperty =
        AvaloniaProperty.Register<CardGrid, bool>(nameof(UniformRows), true);

    static CardGrid() => AffectsMeasure<CardGrid>(MinItemWidthProperty, MaxColumnsProperty, SpacingProperty, UniformRowsProperty);

    /// <inheritdoc cref="MinItemWidthProperty"/>
    public double MinItemWidth
    {
        get => GetValue(MinItemWidthProperty);
        set => SetValue(MinItemWidthProperty, value);
    }

    /// <inheritdoc cref="MaxColumnsProperty"/>
    public int MaxColumns
    {
        get => GetValue(MaxColumnsProperty);
        set => SetValue(MaxColumnsProperty, value);
    }

    /// <inheritdoc cref="SpacingProperty"/>
    public double Spacing
    {
        get => GetValue(SpacingProperty);
        set => SetValue(SpacingProperty, value);
    }

    /// <inheritdoc cref="UniformRowsProperty"/>
    public bool UniformRows
    {
        get => GetValue(UniformRowsProperty);
        set => SetValue(UniformRowsProperty, value);
    }

    /// <summary>The number of columns for a width.</summary>
    public int ColumnsFor(double width) =>
        Math.Clamp((int)Math.Floor((width + Spacing) / (MinItemWidth + Spacing)), 1, Math.Max(1, MaxColumns));

    private double[] _rowHeights = [];
    private int _columns = 1;
    private double _itemWidth;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var children = Children.Where(c => c.IsVisible).ToArray();
        var width = double.IsInfinity(availableSize.Width) ? MaxColumns * (MinItemWidth + Spacing) - Spacing : availableSize.Width;
        _columns = ColumnsFor(width);
        _itemWidth = Math.Max(0, (width - Spacing * (_columns - 1)) / _columns);
        var rows = (children.Length + _columns - 1) / _columns;
        _rowHeights = new double[rows];
        for (var i = 0; i < children.Length; i++)
        {
            children[i].Measure(new Size(_itemWidth, double.PositiveInfinity));
            var row = i / _columns;
            _rowHeights[row] = Math.Max(_rowHeights[row], children[i].DesiredSize.Height);
        }
        var height = _rowHeights.Sum() + Spacing * Math.Max(0, rows - 1);
        return new Size(width, height);
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        var children = Children.Where(c => c.IsVisible).ToArray();
        var y = 0.0;
        for (var i = 0; i < children.Length; i++)
        {
            var row = i / _columns;
            var column = i % _columns;
            if (column == 0 && row > 0) y += _rowHeights[row - 1] + Spacing;
            var height = UniformRows ? _rowHeights[row] : children[i].DesiredSize.Height;
            children[i].Arrange(new Rect(column * (_itemWidth + Spacing), y, _itemWidth, height));
        }
        return finalSize;
    }
}
