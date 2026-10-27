using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Controls.Presenters;
using Avalonia.Interactivity;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The Windows text size (Settings > Accessibility > Text size; docs/EVENTS.md §2.20 "Text size", §6.4 "Text size and
/// contrast"): <see cref="ReadSystem"/> reads <c>UISettings.TextScaleFactor</c> on the Windows target (at start and on
/// window activation), and <see cref="ScaleProperty"/>, set on a window and inherited by everything in it (dialogs and
/// flyouts included), multiplies the font size of every <see cref="TextBlock"/> and <see cref="TextPresenter"/> (the text
/// of text boxes) through a coercion of their <c>FontSize</c>, so Thirteen's own sizes, whether set in a style, inline or
/// inherited, grow with it. Icon glyphs (<c>TextBlock.icon</c>) keep their size, as their buttons do. The Calendar
/// layouts read the same factor from <c>AppState.TextScale</c> (lane heights, Month's list of days at 150 % and above).
/// </summary>
public static class TextScaling
{
    private static bool _installed;

    /// <summary>The text scale of a window and everything in it (1 = 100 %, at most 2.25).</summary>
    public static readonly AttachedProperty<double> ScaleProperty =
        AvaloniaProperty.RegisterAttached<StyledElement, double>("Scale", typeof(TextScaling), 1.0, inherits: true);

    /// <summary>The scale of an element.</summary>
    public static double GetScale(AvaloniaObject element) => element.GetValue(ScaleProperty);

    /// <summary>Sets the scale of an element (a window); its descendants inherit it.</summary>
    public static void SetScale(AvaloniaObject element, double value) => element.SetValue(ScaleProperty, Clamp(value));

    /// <summary>1 to 2.25 (the range of Windows' text size); anything else is 1.</summary>
    public static double Clamp(double value) => double.IsFinite(value) ? Math.Clamp(value, 1, 2.25) : 1;

    /// <summary>
    /// Installs the font-size coercion of <see cref="TextBlock"/> and <see cref="TextPresenter"/> (once per process, before
    /// the first window is built; <c>App.Initialize</c>). Without a scale set anywhere it changes nothing.
    /// </summary>
    public static void Install()
    {
        if (_installed) return;
        _installed = true;
        // The default size is passed on: an override without one would validate a default of 0.
        TextBlock.FontSizeProperty.OverrideMetadata<TextBlock>(
            new StyledPropertyMetadata<double>(DefaultSize<TextBlock>(TextBlock.FontSizeProperty), coerce: CoerceTextBlock));
        TextElement.FontSizeProperty.OverrideMetadata<TextPresenter>(
            new StyledPropertyMetadata<double>(DefaultSize<TextPresenter>(TextElement.FontSizeProperty), coerce: CoercePresenter));
        ScaleProperty.Changed.AddClassHandler<TextBlock>((block, _) => block.CoerceValue(TextBlock.FontSizeProperty));
        ScaleProperty.Changed.AddClassHandler<TextPresenter>((presenter, _) => presenter.CoerceValue(TextElement.FontSizeProperty));
        // A TextBlock gets its classes (an icon) after its first size: coerce again when it is shown.
        Control.LoadedEvent.AddClassHandler<TextBlock>((block, _) => block.CoerceValue(TextBlock.FontSizeProperty), RoutingStrategies.Direct);
        // A dialog is a window of its own: it takes its owner's scale when it opens (and is laid out).
        Window.WindowOpenedEvent.AddClassHandler<Window>((window, _) => TakeOwnersScale(window));
        Control.LoadedEvent.AddClassHandler<Window>((window, _) => TakeOwnersScale(window), RoutingStrategies.Direct);
    }

    private static void TakeOwnersScale(Window window)
    {
        if (window.Owner is Window owner && !window.IsSet(ScaleProperty)) window.SetValue(ScaleProperty, owner.GetValue(ScaleProperty));
    }

    private static double DefaultSize<T>(StyledProperty<double> property) where T : AvaloniaObject =>
        property.GetMetadata(typeof(T)) is StyledPropertyMetadata<double> metadata && metadata.DefaultValue > 0 ? metadata.DefaultValue : 12;

    private static double CoerceTextBlock(AvaloniaObject target, double value)
    {
        if (target is StyledElement element && element.Classes.Contains("icon")) return value;
        return Scaled(target, value);
    }

    private static double CoercePresenter(AvaloniaObject target, double value) => Scaled(target, value);

    private static double Scaled(AvaloniaObject target, double value)
    {
        var scale = target.GetValue(ScaleProperty);
        return scale is > 1 and <= 2.25 && double.IsFinite(value) ? Math.Round(value * scale, 2) : value;
    }

    /// <summary>
    /// Windows' text size (<c>UISettings.TextScaleFactor</c>, 1 to 2.25) on the Windows target; null elsewhere or when it
    /// cannot be read.
    /// </summary>
    public static double? ReadSystem()
    {
#if WINDOWS
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 10240)) return null;
        try
        {
            return Clamp(new Windows.UI.ViewManagement.UISettings().TextScaleFactor);
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Thirteen: the text size could not be read (0x{e.HResult:X8})");
            return null;
        }
#else
        return null;
#endif
    }
}
