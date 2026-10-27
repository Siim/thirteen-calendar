using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Presenters;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.Events;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests;

/// <summary>
/// The large-text check of task W10 (docs/EVENTS.md §2.20 "Text size", §2.4, §2.11, §2.12): at Windows' 150 % every
/// Calendar mode, Today and Settings, and at 150 % and at its largest size, 225 %, the editor, the repeat picker and the
/// event details (all of them at 100 % too) are laid out without a line of text cut off: every visible text either fits its box, ends in an
/// ellipsis, or wraps, none is cut at the side by a clipping parent, and none runs past the edge of its window. Month
/// shows the list of days and Week falls back to Day at these sizes. Set THIRTEEN_TEST_SCREENSHOTS to a folder to save
/// what they render.
/// </summary>
public class TextScaleTests
{
    public static TheoryData<string> Scales => ["1", "1.5", "2.25"];

    /// <summary>
    /// The window at 150 % (and at 100 %, as a guard). At 225 % the older screens' fixed grids still cut text: Year's
    /// Gregorian month labels in its 36 px day cells, the day details' comparison facts and weekday strips beside the Day
    /// timeline, and one theme tile's name in Settings; recorded in docs/events-verification/windows.md.
    /// </summary>
    [AvaloniaTheory]
    [InlineData("1.5")]
    [InlineData("1")]
    public void NoTextIsCutInTheWindow(string scale)
    {
        var (window, model) = Open("--text-scale", scale, "--page", "calendar");
        Assert.Equal(double.Parse(scale, System.Globalization.CultureInfo.InvariantCulture), TextScaling.GetScale(window));
        var problems = new List<string>();
        foreach (var mode in new[] { CalendarMode.Day, CalendarMode.Week, CalendarMode.Month, CalendarMode.Year, CalendarMode.List })
        {
            model.CalendarPage.Mode = mode;
            Render();
            // Week falls back to Day at 150 % and above (§2.20).
            if (mode == CalendarMode.Week && TextScaling.GetScale(window) >= 1.5) Assert.Equal(CalendarMode.Day, model.CalendarPage.DisplayedMode);
            Save(window, $"windows-text-{Percent(scale)}-{mode.Id()}.png");
            problems.AddRange(CutTexts(window).Select(p => $"{mode}: {p}"));
        }
        foreach (var section in new[] { AppSection.Today, AppSection.Settings })
        {
            model.Section = section;
            Render();
            Save(window, $"windows-text-{Percent(scale)}-{section.Id()}.png");
            problems.AddRange(CutTexts(window).Select(p => $"{section}: {p}"));
        }
        window.Close();
        Assert.True(problems.Count == 0, string.Join(Environment.NewLine, problems));
    }

    [AvaloniaTheory]
    [MemberData(nameof(Scales))]
    public void NoTextIsCutInTheEditorAndItsPickers(string scale)
    {
        var (window, model) = Open("--text-scale", scale, "--page", "calendar");
        var problems = new List<string>();

        // The editor of an existing repeating event, with its repeat and alert rows filled in.
        var actions = window.EventActions!;
        model.CalendarPage.Mode = CalendarMode.Day;
        Render();
        var book = window.GetVisualDescendants().OfType<Button>()
            .First(b => b.Classes.Contains("timelineBlock") && (Avalonia.Automation.AutomationProperties.GetName(b) ?? "").StartsWith("Book club", StringComparison.Ordinal));
        // The details, opened as a double-click or Enter on the block opens them (the block's command only selects it).
        var item = Assert.IsType<TimelineBlock>(book.DataContext).Item;
        actions.ShowDetails(item, book);
        Render();
        var view = window.EventsUi.DetailsView;
        Assert.NotNull(view);
        Assert.Contains(view.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == item.Title);
        if (TextScaling.GetScale(window) >= 1.5)
        {
            // A dialog at these sizes (§2.20 "every popover ... is shown as a sheet").
            var details = window.EventsUi.Dialogs.LastOrDefault();
            Assert.NotNull(details);
            Assert.True(details.IsVisualAncestorOf(view));
            Save(details, $"windows-text-{Percent(scale)}-details.png");
            problems.AddRange(CutTexts(details).Select(p => $"details: {p}"));
            details.Close();
        }
        else
        {
            // A flyout: in its popup root (on the headless platform, the window's overlay layer).
            var popup = TopLevel.GetTopLevel(view);
            Assert.NotNull(popup);
            Assert.True(popup.IsVisualAncestorOf(view) && view.IsEffectivelyVisible);
            Save(popup, $"windows-text-{Percent(scale)}-details.png");
            problems.AddRange(CutTexts(popup).Select(p => $"details flyout: {p}"));
            window.EventsUi.CloseDetails();
        }
        Render();

        actions.NewEvent(LaunchOptions.MockupToday, null, null, null);
        Render();
        var editor = window.EventsUi.Dialogs.OfType<EventEditorDialog>().Last();
        // Labels stack above their fields at 150 % and above (§2.11).
        Assert.Equal(TextScaling.GetScale(window) >= 1.5, editor.Model!.LargeText);
        editor.FindControl<TextBox>("TitleBox")!.Text = "Quarterly planning with the whole design team";
        Render();
        Save(editor, $"windows-text-{Percent(scale)}-editor.png");
        problems.AddRange(CutTexts(editor).Select(p => $"editor: {p}"));

        editor.FindControl<Button>("RepeatButton")!.Command!.Execute(null);
        Render();
        var picker = window.EventsUi.Dialogs.OfType<RepeatPickerDialog>().Last();
        Save(picker, $"windows-text-{Percent(scale)}-repeat-picker.png");
        problems.AddRange(CutTexts(picker).Select(p => $"repeat picker: {p}"));
        picker.Close();
        Render();
        editor.Model.Close();
        Render();
        window.Close();
        Assert.True(problems.Count == 0, string.Join(Environment.NewLine, problems));
    }

    /// <summary>
    /// Visible texts that are cut: wider than their own box with neither an ellipsis nor wrapping, cut at the side by a
    /// clipping parent (other than a scrolled area), or running past the right or bottom edge of their window (outside a
    /// scrolled area).
    /// </summary>
    internal static IEnumerable<string> CutTexts(TopLevel root)
    {
        foreach (var block in root.GetVisualDescendants().OfType<TextBlock>())
        {
            if (!block.IsEffectivelyVisible || string.IsNullOrWhiteSpace(block.Text) || block.Bounds.Width <= 0) continue;
            if (block.Classes.Contains("icon")) continue;
            var layout = block.TextLayout;
            var room = block.Bounds.Width - block.Padding.Left - block.Padding.Right;
            if (block.TextTrimming == Avalonia.Media.TextTrimming.None && block.TextWrapping == Avalonia.Media.TextWrapping.NoWrap
                && layout.WidthIncludingTrailingWhitespace > room + 1)
            {
                yield return $"\"{block.Text}\" needs {layout.WidthIncludingTrailingWhitespace:0} px, has {room:0}";
                continue;
            }
            if (layout.Height > block.Bounds.Height + 1 && block.TextWrapping != Avalonia.Media.TextWrapping.NoWrap
                && block.TextTrimming == Avalonia.Media.TextTrimming.None)
            {
                yield return $"\"{block.Text}\" needs {layout.Height:0} px of height, has {block.Bounds.Height:0}";
                continue;
            }
            // A wrapping text breaks a word that is wider than its box in the middle ("Calend" / "ar"): that is a cut too.
            if (block.TextWrapping != Avalonia.Media.TextWrapping.NoWrap && block.TextTrimming == Avalonia.Media.TextTrimming.None
                && WidestWord(block) is { } widest && widest.Width > room + 1)
            {
                yield return $"\"{block.Text}\" has the word \"{widest.Word}\" of {widest.Width:0} px in a box of {room:0}";
                continue;
            }
            // A negative margin is a deliberate trim of empty side bearing (the date plate's numeral), not a cut.
            var slackLeft = 1 + Math.Max(0, -block.Margin.Left);
            var slackRight = 1 + Math.Max(0, -block.Margin.Right);
            // Both edges through the transforms between them (a Viewbox scales its content).
            var clipper = block.GetVisualAncestors().OfType<Visual>().FirstOrDefault(a => a.ClipToBounds && a is not ScrollContentPresenter
                && block.TranslatePoint(default, a) is { } left && block.TranslatePoint(new Point(block.Bounds.Width, 0), a) is { } right
                && (left.X < -slackLeft || right.X > a.Bounds.Width + slackRight));
            if (clipper is not null)
            {
                var start = block.TranslatePoint(default, clipper)!.Value.X;
                var end = block.TranslatePoint(new Point(block.Bounds.Width, 0), clipper)!.Value.X;
                yield return $"\"{block.Text}\" is cut by its {clipper.GetType().Name} ({start:0} to {end:0} of {clipper.Bounds.Width:0})";
                continue;
            }
            if (block.GetVisualAncestors().Any(a => a is ScrollContentPresenter)) continue;
            if (block.TranslatePoint(new Point(block.Bounds.Width, block.Bounds.Height), root) is { } corner
                && (corner.X > root.Bounds.Width + 1 || corner.Y > root.Bounds.Height + 1))
            {
                yield return $"\"{block.Text}\" runs past the window ({corner.X:0}, {corner.Y:0} of {root.Bounds.Width:0} x {root.Bounds.Height:0})";
            }
        }
    }

    /// <summary>The widest whitespace-separated word of a text block, measured in its own font.</summary>
    private static (string Word, double Width)? WidestWord(TextBlock block)
    {
        var typeface = new Avalonia.Media.Typeface(block.FontFamily, block.FontStyle, block.FontWeight, block.FontStretch);
        (string, double)? widest = null;
        foreach (var word in (block.Text ?? "").Split([' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries))
        {
            using var layout = new Avalonia.Media.TextFormatting.TextLayout(word, typeface, block.FontSize, null, letterSpacing: block.LetterSpacing,
                textStyleOverrides: null);
            if (widest is null || layout.WidthIncludingTrailingWhitespace > widest.Value.Item2) widest = (word, layout.WidthIncludingTrailingWhitespace);
        }
        return widest;
    }

    private static (MainWindow Window, MainViewModel Model) Open(params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--fake-events", "--width", "1280", "--height", "800"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        window.Show();
        Render();
        window.EventActions!.ScreenReaderRunning = () => false;
        return (window, model);
    }

    private static void Render()
    {
        for (var i = 0; i < 6; i++) Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        for (var i = 0; i < 2; i++) Dispatcher.UIThread.RunJobs();
    }

    private static string Percent(string scale) =>
        Math.Round(double.Parse(scale, System.Globalization.CultureInfo.InvariantCulture) * 100).ToString(System.Globalization.CultureInfo.InvariantCulture);

    private static void Save(TopLevel window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }
}
