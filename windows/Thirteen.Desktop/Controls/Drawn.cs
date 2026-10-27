using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Avalonia.Styling;
using Thirteen.Core;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Themes;

namespace Thirteen.Desktop.Controls;

/// <summary>The bundled typefaces (design/DECISIONS.md), for controls that draw their own text.</summary>
public static class AppFonts
{
    /// <summary>Geist.</summary>
    public static FontFamily Sans { get; } = new("avares://Thirteen/Assets/Fonts#Geist");

    /// <summary>Geist Mono.</summary>
    public static FontFamily Mono { get; } = new("avares://Thirteen/Assets/Fonts#Geist Mono");

    internal static FormattedText Text(string text, FontFamily family, double size, FontWeight weight, IBrush brush) =>
        new(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface(family, FontStyle.Normal, weight), size, brush);

    internal static ImmutableSolidColorBrush Brush(Color color, double opacity = 1) =>
        new ImmutableSolidColorBrush(opacity >= 1 ? color : ThemeResources.WithAlpha(color, opacity));
}

/// <summary>
/// Progress through the year across 13 equal months (SPEC 5.1): 13 identical segments, with the
/// intercalary day(s) as small seals in their true positions (IFC Leap Day after June, the year-end day(s)
/// after the last month), and month initials underneath. Port of the Apple apps' YearProgressView.
/// </summary>
public sealed class YearProgressBar : Control
{
    /// <summary>The day whose progress is shown.</summary>
    public static readonly StyledProperty<Comparison?> ComparisonProperty =
        AvaloniaProperty.Register<YearProgressBar, Comparison?>(nameof(Comparison));

    /// <summary>Fill and marks.</summary>
    public static readonly StyledProperty<Color> AccentColorProperty =
        AvaloniaProperty.Register<YearProgressBar, Color>(nameof(AccentColor), Colors.OrangeRed);

    /// <summary>Empty track.</summary>
    public static readonly StyledProperty<Color> TrackColorProperty =
        AvaloniaProperty.Register<YearProgressBar, Color>(nameof(TrackColor), Colors.LightGray);

    /// <summary>Month initials.</summary>
    public static readonly StyledProperty<Color> LabelColorProperty =
        AvaloniaProperty.Register<YearProgressBar, Color>(nameof(LabelColor), Colors.Gray);

    /// <summary>The current month's initial.</summary>
    public static readonly StyledProperty<Color> CurrentLabelColorProperty =
        AvaloniaProperty.Register<YearProgressBar, Color>(nameof(CurrentLabelColor), Colors.OrangeRed);

    /// <summary>Whether month initials are drawn under the segments.</summary>
    public static readonly StyledProperty<bool> ShowsLabelsProperty =
        AvaloniaProperty.Register<YearProgressBar, bool>(nameof(ShowsLabels), true);

    private const double SegmentHeight = 10;
    private const double Gap = 3;
    private const double SealSize = 10;
    private const double LabelGap = 5;
    private const double LabelHeight = 15;

    static YearProgressBar()
    {
        AffectsRender<YearProgressBar>(ComparisonProperty, AccentColorProperty, TrackColorProperty, LabelColorProperty, CurrentLabelColorProperty, ShowsLabelsProperty);
        AffectsMeasure<YearProgressBar>(ShowsLabelsProperty);
    }

    /// <inheritdoc cref="ComparisonProperty"/>
    public Comparison? Comparison
    {
        get => GetValue(ComparisonProperty);
        set => SetValue(ComparisonProperty, value);
    }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor
    {
        get => GetValue(AccentColorProperty);
        set => SetValue(AccentColorProperty, value);
    }

    /// <inheritdoc cref="TrackColorProperty"/>
    public Color TrackColor
    {
        get => GetValue(TrackColorProperty);
        set => SetValue(TrackColorProperty, value);
    }

    /// <inheritdoc cref="LabelColorProperty"/>
    public Color LabelColor
    {
        get => GetValue(LabelColorProperty);
        set => SetValue(LabelColorProperty, value);
    }

    /// <inheritdoc cref="CurrentLabelColorProperty"/>
    public Color CurrentLabelColor
    {
        get => GetValue(CurrentLabelColorProperty);
        set => SetValue(CurrentLabelColorProperty, value);
    }

    /// <inheritdoc cref="ShowsLabelsProperty"/>
    public bool ShowsLabels
    {
        get => GetValue(ShowsLabelsProperty);
        set => SetValue(ShowsLabelsProperty, value);
    }

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize) =>
        new(double.IsInfinity(availableSize.Width) ? 320 : availableSize.Width, ShowsLabels ? SegmentHeight + LabelGap + LabelHeight : SegmentHeight);

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        if (Comparison is not { } c) return;
        var system = c.Thirteen.System;
        var occurrences = IntercalaryOccurrence.InYear(c.Gregorian.Year, system);
        var months = system.Months();
        var width = Bounds.Width;
        var columns = months.Count + occurrences.Count;
        var monthWidth = (width - Gap * (columns - 1) - SealSize * occurrences.Count) / months.Count;
        if (monthWidth <= 0) return;

        var accent = AppFonts.Brush(AccentColor);
        var accentFaint = AppFonts.Brush(AccentColor, 0.4);
        var track = AppFonts.Brush(TrackColor);
        var currentMonth = c.Thirteen.MonthDate?.Month;
        var labels = new List<(string Text, double X, bool IsCurrent)>();
        var x = 0.0;
        foreach (var info in months)
        {
            var (done, isCurrent) = Fill(c, info.Index);
            var rect = new Rect(x, 0, monthWidth, SegmentHeight);
            var shape = new RoundedRect(rect, SegmentHeight / 2);
            context.DrawRectangle(track, null, shape);
            // Drawn as geometry rather than through PushClip: text drawn after a pushed rounded clip went
            // missing (with everything after it) in Avalonia's renderers.
            const double r = SegmentHeight / 2;
            if (done >= 1) context.DrawRectangle(accent, null, shape);
            else if (done > 0)
            {
                var filled = Math.Max(monthWidth * done, r);
                context.DrawRectangle(accent, null, new RoundedRect(new Rect(x, 0, filled, SegmentHeight), new CornerRadius(r, 0, 0, r)));
            }
            if (isCurrent)
            {
                var start = x + Math.Max(monthWidth * done, done > 0 ? r : 0);
                var end = Math.Min(start + Math.Max(monthWidth / 28, 2), x + monthWidth);
                var corners = done > 0 ? new CornerRadius(0) : new CornerRadius(r, 0, 0, r);
                if (end > start) context.DrawRectangle(accentFaint, null, new RoundedRect(new Rect(start, 0, end - start, SegmentHeight), corners));
            }
            if (isCurrent) context.DrawRectangle(null, new ImmutablePen(accent, 1), shape.Deflate(0.5, 0.5));

            if (ShowsLabels) labels.Add((info.ShortName[..1], x, info.Index == currentMonth));
            x += monthWidth + Gap;

            foreach (var occurrence in occurrences.Where(o => o.AfterMonth == info.Index))
            {
                var passed = occurrence.DayOfYear < c.DayOfYear;
                var isToday = occurrence.DayOfYear == c.DayOfYear;
                var center = new Point(x + SealSize / 2, SegmentHeight / 2);
                context.DrawEllipse(passed || isToday ? accent : track, new ImmutablePen(accent, isToday ? 2 : 1), center, SealSize / 2 - 0.5, SealSize / 2 - 0.5);
                x += SealSize + Gap;
            }
        }

        foreach (var (text, left, current) in labels)
        {
            var label = AppFonts.Text(text, AppFonts.Mono, 10.5, current ? FontWeight.Bold : FontWeight.Regular,
                AppFonts.Brush(current ? CurrentLabelColor : LabelColor));
            context.DrawText(label, new Point(left + (monthWidth - label.Width) / 2, SegmentHeight + LabelGap));
        }
    }

    /// <summary>Completed fraction of month <paramref name="month"/> at the start of the day, and whether the day is in it.</summary>
    private static (double Done, bool IsCurrent) Fill(Comparison c, int month) => c.Thirteen switch
    {
        ThirteenMonthDate date when month < date.Month => (1, false),
        ThirteenMonthDate date when month > date.Month => (0, false),
        ThirteenMonthDate date => ((date.Day - 1) / 28.0, true),
        ThirteenIntercalaryDate date => (month <= date.Info.AfterMonth ? 1 : 0, false),
        _ => (0, false),
    };
}

/// <summary>
/// 12 vs 13 on one day-of-year axis (SPEC 3 month alignment): the ragged Gregorian months on top, the 13
/// equal months and intercalary day(s) below, with every month boundary drawn so the mismatch is visible
/// at a glance. Port of the Apple apps' MonthRibbonView. Screen readers get the boundaries in words through
/// AutomationProperties.Name set by the view.
/// </summary>
public sealed class MonthRibbon : Control
{
    /// <summary>The year's alignment.</summary>
    public static readonly StyledProperty<MonthAlignment?> AlignmentProperty =
        AvaloniaProperty.Register<MonthRibbon, MonthAlignment?>(nameof(Alignment));

    /// <summary>Day of year to mark (today), if in this year.</summary>
    public static readonly StyledProperty<int?> MarkedDayOfYearProperty =
        AvaloniaProperty.Register<MonthRibbon, int?>(nameof(MarkedDayOfYear));

    /// <summary>The Gregorian colour.</summary>
    public static readonly StyledProperty<Color> FoilColorProperty =
        AvaloniaProperty.Register<MonthRibbon, Color>(nameof(FoilColor), Colors.SlateGray);

    /// <summary>The 13-month colour.</summary>
    public static readonly StyledProperty<Color> AccentColorProperty =
        AvaloniaProperty.Register<MonthRibbon, Color>(nameof(AccentColor), Colors.OrangeRed);

    /// <summary>The 13-month caption colour.</summary>
    public static readonly StyledProperty<Color> AccentTextColorProperty =
        AvaloniaProperty.Register<MonthRibbon, Color>(nameof(AccentTextColor), Colors.OrangeRed);

    /// <summary>Labels and the today marker.</summary>
    public static readonly StyledProperty<Color> InkColorProperty =
        AvaloniaProperty.Register<MonthRibbon, Color>(nameof(InkColor), Colors.Black);

    /// <summary>Fill of the lighter Gregorian bands (ThFoilBand1: a foil tone, hatched in Mono); null for a foil tone.</summary>
    public static readonly StyledProperty<IBrush?> GregorianBandBrushProperty =
        AvaloniaProperty.Register<MonthRibbon, IBrush?>(nameof(GregorianBandBrush));

    /// <summary>Fill of the stronger Gregorian bands (ThFoilBand2); null for a foil tone.</summary>
    public static readonly StyledProperty<IBrush?> GregorianBandStrongBrushProperty =
        AvaloniaProperty.Register<MonthRibbon, IBrush?>(nameof(GregorianBandStrongBrush));

    private const double BandHeight = 38;
    private const double BandGap = 18;
    private const double CaptionHeight = 18;

    static MonthRibbon() =>
        AffectsRender<MonthRibbon>(AlignmentProperty, MarkedDayOfYearProperty, FoilColorProperty, AccentColorProperty, AccentTextColorProperty, InkColorProperty,
            GregorianBandBrushProperty, GregorianBandStrongBrushProperty);

    /// <inheritdoc cref="AlignmentProperty"/>
    public MonthAlignment? Alignment
    {
        get => GetValue(AlignmentProperty);
        set => SetValue(AlignmentProperty, value);
    }

    /// <inheritdoc cref="MarkedDayOfYearProperty"/>
    public int? MarkedDayOfYear
    {
        get => GetValue(MarkedDayOfYearProperty);
        set => SetValue(MarkedDayOfYearProperty, value);
    }

    /// <inheritdoc cref="FoilColorProperty"/>
    public Color FoilColor
    {
        get => GetValue(FoilColorProperty);
        set => SetValue(FoilColorProperty, value);
    }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor
    {
        get => GetValue(AccentColorProperty);
        set => SetValue(AccentColorProperty, value);
    }

    /// <inheritdoc cref="AccentTextColorProperty"/>
    public Color AccentTextColor
    {
        get => GetValue(AccentTextColorProperty);
        set => SetValue(AccentTextColorProperty, value);
    }

    /// <inheritdoc cref="InkColorProperty"/>
    public Color InkColor
    {
        get => GetValue(InkColorProperty);
        set => SetValue(InkColorProperty, value);
    }

    /// <inheritdoc cref="GregorianBandBrushProperty"/>
    public IBrush? GregorianBandBrush
    {
        get => GetValue(GregorianBandBrushProperty);
        set => SetValue(GregorianBandBrushProperty, value);
    }

    /// <inheritdoc cref="GregorianBandStrongBrushProperty"/>
    public IBrush? GregorianBandStrongBrush
    {
        get => GetValue(GregorianBandStrongBrushProperty);
        set => SetValue(GregorianBandStrongBrushProperty, value);
    }

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize) =>
        new(double.IsInfinity(availableSize.Width) ? 600 : availableSize.Width, CaptionHeight * 2 + BandHeight * 2 + BandGap);

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        if (Alignment is not { } alignment) return;
        var days = (double)alignment.DaysInYear;
        var width = Bounds.Width;
        double X(int dayOfYear) => Math.Round((dayOfYear - 1) / days * width);

        const double topY = CaptionHeight;
        const double bottomY = CaptionHeight + BandHeight + BandGap;

        var foil = AppFonts.Brush(FoilColor);
        var accent = AppFonts.Brush(AccentColor);
        var ink = AppFonts.Brush(InkColor);

        var top = AppFonts.Text("12 · GREGORIAN", AppFonts.Mono, 10, FontWeight.Medium, foil);
        context.DrawText(top, new Point(0, (CaptionHeight - top.Height) / 2 - 2));
        var bottom = AppFonts.Text($"13 · {alignment.System.ShortName().ToUpperInvariant()}", AppFonts.Mono, 10, FontWeight.Medium, AppFonts.Brush(AccentTextColor));
        context.DrawText(bottom, new Point(0, bottomY + BandHeight + (CaptionHeight - bottom.Height) / 2 + 2));

        foreach (var span in alignment.GregorianMonths)
        {
            var rect = new Rect(X(span.StartDayOfYear) + 1, topY, Math.Max(X(span.EndDayOfYear + 1) - X(span.StartDayOfYear) - 2, 1), BandHeight);
            var band = span.Month % 2 == 0
                ? GregorianBandBrush ?? AppFonts.Brush(FoilColor, 0.22)
                : GregorianBandStrongBrush ?? AppFonts.Brush(FoilColor, 0.36);
            context.DrawRectangle(band, null, new RoundedRect(rect, 4));
        }
        foreach (var span in alignment.ThirteenMonths)
        {
            var rect = new Rect(X(span.StartDayOfYear) + 1, bottomY, Math.Max(X(span.EndDayOfYear + 1) - X(span.StartDayOfYear) - 2, 1), BandHeight);
            context.DrawRectangle(AppFonts.Brush(AccentColor, span.Month % 2 == 0 ? 0.2 : 0.34), null, new RoundedRect(rect, 4));
        }
        foreach (var day in alignment.Intercalary)
        {
            var center = (X(day.DayOfYear) + X(day.DayOfYear + 1)) / 2;
            context.DrawRectangle(accent, null, new RoundedRect(new Rect(center - 1.5, bottomY - 3, 3, BandHeight + 6), 1.5));
        }

        if (MarkedDayOfYear is { } marked)
        {
            var center = Math.Round((X(marked) + X(marked + 1)) / 2) + 0.5;
            var solid = new ImmutablePen(ink, 1.5, lineCap: PenLineCap.Round);
            context.DrawLine(solid, new Point(center, topY - 4), new Point(center, topY));
            context.DrawLine(solid, new Point(center, topY + BandHeight), new Point(center, bottomY));
            context.DrawLine(solid, new Point(center, bottomY + BandHeight), new Point(center, bottomY + BandHeight + 4));
            var faint = new ImmutablePen(AppFonts.Brush(InkColor, 0.35), 1);
            context.DrawLine(faint, new Point(center, topY), new Point(center, topY + BandHeight));
            context.DrawLine(faint, new Point(center, bottomY), new Point(center, bottomY + BandHeight));
            context.DrawEllipse(ink, null, new Point(center, topY - 6), 4, 4);
        }

        Labels(context, alignment.GregorianMonths.Select(s => (s.MonthInfo.ShortName, s.StartDayOfYear, s.EndDayOfYear)).ToArray(), topY, X, ink);
        Labels(context, alignment.ThirteenMonths.Select(s => (s.MonthInfo.ShortName, s.StartDayOfYear, s.EndDayOfYear)).ToArray(), bottomY, X, ink);

        var foilPen = new ImmutablePen(foil, 1);
        foreach (var span in alignment.GregorianMonths.Skip(1))
        {
            var x = X(span.StartDayOfYear) + 0.5;
            context.DrawLine(foilPen, new Point(x, topY + BandHeight), new Point(x, topY + BandHeight + BandGap * 0.55));
        }
        var accentPen = new ImmutablePen(accent, 1);
        foreach (var span in alignment.ThirteenMonths.Skip(1))
        {
            var x = X(span.StartDayOfYear) + 0.5;
            context.DrawLine(accentPen, new Point(x, bottomY), new Point(x, bottomY - BandGap * 0.55));
        }
    }

    /// <summary>Month labels for one band, all in one form: the short name if every one fits, else the initial, else none.</summary>
    private static void Labels(DrawingContext context, (string Name, int Start, int End)[] months, double y, Func<int, double> x, IBrush ink)
    {
        var rects = months.Select(m => new Rect(x(m.Start), y, x(m.End + 1) - x(m.Start), BandHeight)).ToArray();
        foreach (var form in new Func<string, string>[] { n => n, n => n[..1] })
        {
            var texts = months.Select(m => AppFonts.Text(form(m.Name), AppFonts.Mono, 10, FontWeight.Medium, ink)).ToArray();
            if (!texts.Zip(rects).All(p => p.First.Width + 3 <= p.Second.Width)) continue;
            foreach (var (text, rect) in texts.Zip(rects))
            {
                context.DrawText(text, new Point(rect.Center.X - text.Width / 2, rect.Center.Y - text.Height / 2));
            }
            return;
        }
    }
}

/// <summary>
/// Month lengths on one shared 0 to 33 day scale (SPEC 5.4): each bar is four weeks (28 days, a light step)
/// plus the days beyond four weeks (the strong step), so the Gregorian months' 0 to 3 extra days stand out
/// while the 13-month bars are exactly four weeks. Hover, or focus and use the arrow keys, to read a month.
/// </summary>
public sealed class MonthLengthChart : Control
{
    /// <summary>Days per month.</summary>
    public static readonly StyledProperty<IReadOnlyList<int>?> LengthsProperty =
        AvaloniaProperty.Register<MonthLengthChart, IReadOnlyList<int>?>(nameof(Lengths));

    /// <summary>Full month names, for the readout.</summary>
    public static readonly StyledProperty<IReadOnlyList<string>?> NamesProperty =
        AvaloniaProperty.Register<MonthLengthChart, IReadOnlyList<string>?>(nameof(Names));

    /// <summary>
    /// The engine's short month names under the bars ("Pau" for Saint Paul, as on the ribbon and the Apple
    /// charts; the first letter when the bars are narrow). Without them the labels are cut from
    /// <see cref="Names"/>.
    /// </summary>
    public static readonly StyledProperty<IReadOnlyList<string>?> ShortNamesProperty =
        AvaloniaProperty.Register<MonthLengthChart, IReadOnlyList<string>?>(nameof(ShortNames));

    /// <summary>The bar colour.</summary>
    public static readonly StyledProperty<Color> BarColorProperty =
        AvaloniaProperty.Register<MonthLengthChart, Color>(nameof(BarColor), Colors.SlateGray);

    /// <summary>Grid lines.</summary>
    public static readonly StyledProperty<Color> RuleColorProperty =
        AvaloniaProperty.Register<MonthLengthChart, Color>(nameof(RuleColor), Colors.LightGray);

    /// <summary>Axis labels.</summary>
    public static readonly StyledProperty<Color> AxisColorProperty =
        AvaloniaProperty.Register<MonthLengthChart, Color>(nameof(AxisColor), Colors.Gray);

    /// <summary>Value annotations.</summary>
    public static readonly StyledProperty<Color> ValueColorProperty =
        AvaloniaProperty.Register<MonthLengthChart, Color>(nameof(ValueColor), Colors.DimGray);

    /// <summary>Annotate bars of exactly four weeks too (the Gregorian chart: February).</summary>
    public static readonly StyledProperty<bool> AnnotateFourWeekBarsProperty =
        AvaloniaProperty.Register<MonthLengthChart, bool>(nameof(AnnotateFourWeekBars));

    /// <summary>"October: 31 days" for the month under the pointer or keyboard, else empty.</summary>
    public static readonly DirectProperty<MonthLengthChart, string> ReadoutProperty =
        AvaloniaProperty.RegisterDirect<MonthLengthChart, string>(nameof(Readout), o => o.Readout);

    private const double TopPad = 16;
    private const double PlotHeight = 104;
    private const double AxisWidth = 22;
    private const double LabelHeight = 20;
    private const double Max = 33;

    private int _active = -1;
    private string _readout = "";

    static MonthLengthChart()
    {
        AffectsRender<MonthLengthChart>(LengthsProperty, ShortNamesProperty, BarColorProperty, RuleColorProperty, AxisColorProperty, ValueColorProperty, AnnotateFourWeekBarsProperty);
        FocusableProperty.OverrideDefaultValue<MonthLengthChart>(true);
    }

    /// <inheritdoc cref="ShortNamesProperty"/>
    public IReadOnlyList<string>? ShortNames
    {
        get => GetValue(ShortNamesProperty);
        set => SetValue(ShortNamesProperty, value);
    }

    /// <inheritdoc cref="LengthsProperty"/>
    public IReadOnlyList<int>? Lengths
    {
        get => GetValue(LengthsProperty);
        set => SetValue(LengthsProperty, value);
    }

    /// <inheritdoc cref="NamesProperty"/>
    public IReadOnlyList<string>? Names
    {
        get => GetValue(NamesProperty);
        set => SetValue(NamesProperty, value);
    }

    /// <inheritdoc cref="BarColorProperty"/>
    public Color BarColor
    {
        get => GetValue(BarColorProperty);
        set => SetValue(BarColorProperty, value);
    }

    /// <inheritdoc cref="RuleColorProperty"/>
    public Color RuleColor
    {
        get => GetValue(RuleColorProperty);
        set => SetValue(RuleColorProperty, value);
    }

    /// <inheritdoc cref="AxisColorProperty"/>
    public Color AxisColor
    {
        get => GetValue(AxisColorProperty);
        set => SetValue(AxisColorProperty, value);
    }

    /// <inheritdoc cref="ValueColorProperty"/>
    public Color ValueColor
    {
        get => GetValue(ValueColorProperty);
        set => SetValue(ValueColorProperty, value);
    }

    /// <inheritdoc cref="AnnotateFourWeekBarsProperty"/>
    public bool AnnotateFourWeekBars
    {
        get => GetValue(AnnotateFourWeekBarsProperty);
        set => SetValue(AnnotateFourWeekBarsProperty, value);
    }

    /// <inheritdoc cref="ReadoutProperty"/>
    public string Readout
    {
        get => _readout;
        private set => SetAndRaise(ReadoutProperty, ref _readout, value);
    }

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize) =>
        new(double.IsInfinity(availableSize.Width) ? 480 : availableSize.Width, TopPad + PlotHeight + LabelHeight);

    private double Slot => Lengths is { Count: > 0 } lengths ? (Bounds.Width - AxisWidth) / lengths.Count : 0;

    private void SetActive(int index)
    {
        var count = Lengths?.Count ?? 0;
        _active = index >= 0 && index < count ? index : -1;
        Readout = _active >= 0 && Names is { } names && _active < names.Count
            ? $"{names[_active]}: {Phrasing.Days(Lengths![_active])}"
            : "";
        InvalidateVisual();
    }

    /// <inheritdoc />
    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        var x = e.GetPosition(this).X - AxisWidth;
        SetActive(Slot > 0 && x >= 0 ? (int)(x / Slot) : -1);
    }

    /// <inheritdoc />
    protected override void OnPointerExited(PointerEventArgs e)
    {
        base.OnPointerExited(e);
        if (!IsFocused) SetActive(-1);
    }

    /// <inheritdoc />
    protected override void OnGotFocus(GotFocusEventArgs e)
    {
        base.OnGotFocus(e);
        if (_active < 0) SetActive(0);
    }

    /// <inheritdoc />
    protected override void OnLostFocus(Avalonia.Interactivity.RoutedEventArgs e)
    {
        base.OnLostFocus(e);
        SetActive(-1);
    }

    /// <inheritdoc />
    protected override void OnKeyDown(KeyEventArgs e)
    {
        var count = Lengths?.Count ?? 0;
        if (count > 0 && e.KeyModifiers == KeyModifiers.None)
        {
            switch (e.Key)
            {
                case Key.Left:
                    SetActive(Math.Max(0, _active - 1));
                    e.Handled = true;
                    break;
                case Key.Right:
                    SetActive(Math.Min(count - 1, _active + 1));
                    e.Handled = true;
                    break;
            }
        }
        base.OnKeyDown(e);
    }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        if (Lengths is not { Count: > 0 } lengths) return;
        var plotBottom = TopPad + PlotHeight;
        double Y(double days) => plotBottom - days / Max * PlotHeight;
        var slot = Slot;
        var rulePen = new ImmutablePen(AppFonts.Brush(RuleColor), 1);
        var axis = AppFonts.Brush(AxisColor);
        foreach (var tick in new[] { 0, 7, 14, 21, 28 })
        {
            var y = Math.Round(Y(tick)) + 0.5;
            context.DrawLine(rulePen, new Point(AxisWidth, y), new Point(Bounds.Width, y));
            var label = AppFonts.Text(tick.ToString(CultureInfo.InvariantCulture), AppFonts.Mono, 10, FontWeight.Regular, axis);
            context.DrawText(label, new Point(AxisWidth - 6 - label.Width, y - label.Height / 2));
        }

        var names = ShortNames ?? Names;
        var barWidth = slot * 0.62;
        for (var i = 0; i < lengths.Count; i++)
        {
            var days = lengths[i];
            var dim = _active >= 0 && _active != i ? 0.45 : 1;
            var x = AxisWidth + i * slot + (slot - barWidth) / 2;
            var fourWeeks = Math.Min(days, 28);
            var extra = days - 28;
            var lower = new Rect(x, Y(fourWeeks), barWidth, Y(0) - Y(fourWeeks));
            var lowerBrush = AppFonts.Brush(BarColor, 0.45 * dim);
            if (extra > 0)
            {
                context.FillRectangle(lowerBrush, lower);
                var upper = new Rect(x, Y(days), barWidth, Y(28) - Y(days));
                context.DrawRectangle(AppFonts.Brush(BarColor, dim), null, new RoundedRect(upper, new CornerRadius(3, 3, 0, 0)));
            }
            else
            {
                context.DrawRectangle(lowerBrush, null, new RoundedRect(lower, new CornerRadius(3, 3, 0, 0)));
            }
            if (extra > 0 || AnnotateFourWeekBars)
            {
                var value = AppFonts.Text(days.ToString(CultureInfo.InvariantCulture), AppFonts.Mono, 10, FontWeight.Regular, AppFonts.Brush(ValueColor, dim));
                context.DrawText(value, new Point(x + (barWidth - value.Width) / 2, Y(days) - value.Height - 1));
            }
            if (names is not null && i < names.Count)
            {
                var name = slot >= 26 ? names[i][..Math.Min(3, names[i].Length)] : names[i][..1];
                var label = AppFonts.Text(name, AppFonts.Mono, 10, i == _active ? FontWeight.Bold : FontWeight.Regular, axis);
                context.DrawText(label, new Point(AxisWidth + i * slot + (slot - label.Width) / 2, plotBottom + 4));
            }
        }
    }
}

/// <summary>A month silhouette: one square per day on a 7-column grid (Compare, month shapes).</summary>
public sealed class MonthShapeGlyph : Control
{
    /// <summary>Empty cells before day 1.</summary>
    public static readonly StyledProperty<int> LeadingBlanksProperty =
        AvaloniaProperty.Register<MonthShapeGlyph, int>(nameof(LeadingBlanks));

    /// <summary>Days in the month.</summary>
    public static readonly StyledProperty<int> DaysProperty =
        AvaloniaProperty.Register<MonthShapeGlyph, int>(nameof(Days), 28);

    /// <summary>The squares' colour.</summary>
    public static readonly StyledProperty<Color> FillColorProperty =
        AvaloniaProperty.Register<MonthShapeGlyph, Color>(nameof(FillColor), Colors.SlateGray);

    static MonthShapeGlyph()
    {
        AffectsRender<MonthShapeGlyph>(LeadingBlanksProperty, DaysProperty, FillColorProperty);
        AffectsMeasure<MonthShapeGlyph>(LeadingBlanksProperty, DaysProperty);
    }

    /// <inheritdoc cref="LeadingBlanksProperty"/>
    public int LeadingBlanks
    {
        get => GetValue(LeadingBlanksProperty);
        set => SetValue(LeadingBlanksProperty, value);
    }

    /// <inheritdoc cref="DaysProperty"/>
    public int Days
    {
        get => GetValue(DaysProperty);
        set => SetValue(DaysProperty, value);
    }

    /// <inheritdoc cref="FillColorProperty"/>
    public Color FillColor
    {
        get => GetValue(FillColorProperty);
        set => SetValue(FillColorProperty, value);
    }

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var width = double.IsInfinity(availableSize.Width) ? 42 : availableSize.Width;
        return new Size(width, width * 6 / 7);
    }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var cell = Bounds.Width / 7;
        var dot = cell * 0.78;
        var brush = AppFonts.Brush(FillColor);
        for (var i = 0; i < Days; i++)
        {
            var position = LeadingBlanks + i;
            var rect = new Rect((position % 7) * cell + (cell - dot) / 2, (position / 7) * cell + (cell - dot) / 2, dot, dot);
            context.DrawRectangle(brush, null, new RoundedRect(rect, dot * 0.25));
        }
    }
}

/// <summary>
/// The miniature almanac page of a theme swatch (Settings): paper, an ink numeral, a slice of the 4 x 7 grid
/// with today in the accent and a Gregorian month start in the foil, drawn in the theme's own colours for the
/// current light or dark mode.
/// </summary>
public sealed class ThemeSwatchSample : Control
{
    /// <summary>The theme drawn.</summary>
    public static readonly StyledProperty<ThirteenTheme> SwatchThemeProperty =
        AvaloniaProperty.Register<ThemeSwatchSample, ThirteenTheme>(nameof(SwatchTheme));

    /// <summary>Whether it is the chosen theme (accent outline).</summary>
    public static readonly StyledProperty<bool> IsSelectedProperty =
        AvaloniaProperty.Register<ThemeSwatchSample, bool>(nameof(IsSelected));

    static ThemeSwatchSample() => AffectsRender<ThemeSwatchSample>(SwatchThemeProperty, IsSelectedProperty);

    /// <inheritdoc cref="SwatchThemeProperty"/>
    public ThirteenTheme SwatchTheme
    {
        get => GetValue(SwatchThemeProperty);
        set => SetValue(SwatchThemeProperty, value);
    }

    /// <inheritdoc cref="IsSelectedProperty"/>
    public bool IsSelected
    {
        get => GetValue(IsSelectedProperty);
        set => SetValue(IsSelectedProperty, value);
    }

    /// <inheritdoc />
    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == ThemeVariantScope.ActualThemeVariantProperty) InvalidateVisual();
    }

    private const double Pad = 10;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var width = double.IsInfinity(availableSize.Width) ? 112 : availableSize.Width;
        var cell = (width - 2 * Pad - 12) / 7;
        return new Size(width, Pad + 24 + 6 + 2 * cell + 2 + 8 + 3 + Pad);
    }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var p = SwatchTheme.Palette(ActualThemeVariant == ThemeVariant.Dark);
        var bounds = new Rect(Bounds.Size);
        var shape = new RoundedRect(bounds.Deflate(IsSelected ? 1 : 0.5), 6);
        context.DrawRectangle(AppFonts.Brush(p.Paper), new ImmutablePen(AppFonts.Brush(IsSelected ? p.Accent : p.Rule), IsSelected ? 2 : 1), shape);

        var numeral = AppFonts.Text("13", AppFonts.Sans, 20, FontWeight.Bold, AppFonts.Brush(p.Ink));
        context.DrawText(numeral, new Point(Pad, Pad));
        var sol = AppFonts.Text("SOL", AppFonts.Mono, 8, FontWeight.Medium, AppFonts.Brush(p.AccentText));
        context.DrawText(sol, new Point(Pad + numeral.Width + 4, Pad + numeral.Baseline - sol.Baseline));

        var cell = (bounds.Width - 2 * Pad - 12) / 7;
        var top = Pad + 30;
        for (var row = 0; row < 2; row++)
        {
            for (var column = 0; column < 7; column++)
            {
                var index = row * 7 + column;
                var rect = new Rect(Pad + column * (cell + 2), top + row * (cell + 2), cell, cell);
                context.DrawRectangle(AppFonts.Brush(index == 10 ? p.Accent : p.PaperSunk), null, new RoundedRect(rect, 2));
                if (index == 4) context.DrawRectangle(AppFonts.Brush(p.Foil), null, new RoundedRect(new Rect(rect.X, rect.Y + 1, 2, cell - 2), 1));
            }
        }
        var barY = top + 2 * cell + 2 + 8;
        var half = (bounds.Width - 2 * Pad - 3) / 2;
        context.DrawRectangle(AppFonts.Brush(p.Accent), null, new RoundedRect(new Rect(Pad, barY, half, 3), 1.5));
        context.DrawRectangle(AppFonts.Brush(p.PaperSunk), null, new RoundedRect(new Rect(Pad + half + 3, barY, half, 3), 1.5));
    }
}

/// <summary>
/// Decorative backdrop behind the Today hero: a faint 4 x 7 grid fading in towards the bottom and a low
/// accent sun in the top corner (for Sol). Port of the Apple apps' HeroBackdrop.
/// </summary>
public sealed class HeroBackdrop : Control
{
    /// <summary>The surface.</summary>
    public static readonly StyledProperty<Color> SurfaceColorProperty =
        AvaloniaProperty.Register<HeroBackdrop, Color>(nameof(SurfaceColor), Colors.White);

    /// <summary>The grid lines.</summary>
    public static readonly StyledProperty<Color> RuleColorProperty =
        AvaloniaProperty.Register<HeroBackdrop, Color>(nameof(RuleColor), Colors.LightGray);

    /// <summary>The sun.</summary>
    public static readonly StyledProperty<Color> AccentColorProperty =
        AvaloniaProperty.Register<HeroBackdrop, Color>(nameof(AccentColor), Colors.OrangeRed);

    static HeroBackdrop() => AffectsRender<HeroBackdrop>(SurfaceColorProperty, RuleColorProperty, AccentColorProperty);

    /// <inheritdoc cref="SurfaceColorProperty"/>
    public Color SurfaceColor
    {
        get => GetValue(SurfaceColorProperty);
        set => SetValue(SurfaceColorProperty, value);
    }

    /// <inheritdoc cref="RuleColorProperty"/>
    public Color RuleColor
    {
        get => GetValue(RuleColorProperty);
        set => SetValue(RuleColorProperty, value);
    }

    /// <inheritdoc cref="AccentColorProperty"/>
    public Color AccentColor
    {
        get => GetValue(AccentColorProperty);
        set => SetValue(AccentColorProperty, value);
    }

    /// <inheritdoc />
    public override void Render(DrawingContext context)
    {
        var size = Bounds.Size;
        context.FillRectangle(AppFonts.Brush(SurfaceColor), new Rect(size));

        const int columns = 7;
        const int rows = 4;
        var cell = size.Width / columns;
        var gridHeight = cell * rows;
        var originY = size.Height - gridHeight;
        var fadeStart = originY + gridHeight * 0.5;
        double Alpha(double y) => y <= fadeStart ? 0 : 0.4 * (y - fadeStart) / Math.Max(1, size.Height - fadeStart);

        for (var row = 0; row <= rows; row++)
        {
            var y = Math.Round(originY + row * cell) + 0.5;
            var alpha = Alpha(y);
            if (alpha > 0.01) context.DrawLine(new ImmutablePen(AppFonts.Brush(RuleColor, alpha), 1), new Point(0, y), new Point(size.Width, y));
        }
        const int steps = 16;
        for (var column = 0; column <= columns; column++)
        {
            var x = Math.Round(column * cell) + 0.5;
            for (var s = 0; s < steps; s++)
            {
                var y0 = fadeStart + (size.Height - fadeStart) * s / steps;
                var y1 = fadeStart + (size.Height - fadeStart) * (s + 1) / steps;
                var alpha = Alpha((y0 + y1) / 2);
                if (alpha > 0.01) context.DrawLine(new ImmutablePen(AppFonts.Brush(RuleColor, alpha), 1), new Point(x, y0), new Point(x, y1));
            }
        }

        var radius = Math.Min(size.Width, size.Height) * 0.42;
        var center = new Point(size.Width - radius * 0.25, radius * 0.45);
        var sun = new RadialGradientBrush
        {
            GradientStops =
            {
                new GradientStop(ThemeResources.WithAlpha(AccentColor, 0.32), 0),
                new GradientStop(ThemeResources.WithAlpha(AccentColor, 0), 1),
            },
        };
        context.DrawEllipse(sun, null, center, radius, radius);
    }
}
