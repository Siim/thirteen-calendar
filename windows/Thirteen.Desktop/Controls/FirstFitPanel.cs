using Avalonia;
using Avalonia.Controls;

namespace Thirteen.Desktop.Controls;

/// <summary>
/// Shows the first of its children that fits its width, longest form first (a Week column head's Gregorian date: "Thu,
/// Oct 15", then "Oct 15", then "15"), so a narrow column drops words instead of cutting the day number with an ellipsis.
/// The last child is shown when none fits. The others are arranged with no size.
/// </summary>
public sealed class FirstFitPanel : Panel
{
    private int _shown;

    /// <inheritdoc />
    protected override Size MeasureOverride(Size availableSize)
    {
        var children = Children.Where(c => c.IsVisible).ToList();
        if (children.Count == 0) return default;
        foreach (var child in children) child.Measure(new Size(double.PositiveInfinity, availableSize.Height));
        _shown = children.FindIndex(c => c.DesiredSize.Width <= availableSize.Width + 0.5);
        if (_shown < 0) _shown = children.Count - 1;
        var chosen = children[_shown];
        chosen.Measure(availableSize);
        return new Size(Math.Min(chosen.DesiredSize.Width, availableSize.Width), chosen.DesiredSize.Height);
    }

    /// <inheritdoc />
    protected override Size ArrangeOverride(Size finalSize)
    {
        var children = Children.Where(c => c.IsVisible).ToList();
        for (var i = 0; i < children.Count; i++)
        {
            children[i].Arrange(i == _shown ? new Rect(finalSize) : default);
        }
        return finalSize;
    }
}
