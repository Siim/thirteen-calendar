using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;

namespace Thirteen.Desktop;

public partial class App : Application
{
    /// <summary>The theme service of this application (set in <see cref="Initialize"/>).</summary>
    public ThemeService? Themes { get; private set; }

    /// <summary>
    /// Whether the app follows Windows' contrast theme (docs/EVENTS.md §2.20, §6.4 "Text size and contrast"): read when the
    /// window is created, when the platform reports new colour values and on every window activation. False when
    /// <c>--high-contrast</c> fixed it for the run.
    /// </summary>
    public bool FollowsSystemContrast { get; private set; } = true;

    /// <summary>Reads Windows' contrast theme again and applies it (or the chosen theme when it was turned off).</summary>
    public void RefreshHighContrast()
    {
        if (!FollowsSystemContrast || Themes is null) return;
        Themes.HighContrast = SystemHighContrast();
    }

    private HighContrastColors? SystemHighContrast() =>
        HighContrastColors.IsRequested(PlatformSettings?.GetColorValues()) ? HighContrastColors.ReadSystem() : null;

    public override void Initialize()
    {
        // Windows' text size scales every TextBlock's font size (docs/EVENTS.md §2.20; Support/TextScaling.cs).
        Support.TextScaling.Install();
        AvaloniaXamlLoader.Load(this);
        Themes = new ThemeService(this);
        // A first theme before any control exists, so every Th* resource resolves from the start.
        Themes.Apply(ThemeTokens.DefaultTheme, AppearanceMode.System);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            // A contrast theme turned on or off while Thirteen runs (WM_SETTINGCHANGE); activation checks again.
            if (PlatformSettings is { } platform) platform.ColorValuesChanged += (_, _) => Dispatcher.UIThread.Post(RefreshHighContrast);
            var options = Program.Options;
            var window = CreateMainWindow(options, new SettingsStore(readOnly: options.IsReadOnly));
            desktop.MainWindow = window;
            StartEvents(desktop, window, options);
            if (options.Scroll is { } scroll) window.Opened += (_, _) => ScrollPages(window, scroll);
            if (Program.Instance is { } instance)
            {
                instance.Received += link => Dispatcher.UIThread.Post(() => window.OpenFromAnotherStart(link));
                // A second start with a webcal:// or thirteen://subscribe link, or files to import (§6.4 SingleInstance).
                instance.ArgumentsReceived += arguments => Dispatcher.UIThread.Post(() =>
                {
                    if (Support.ExternalRequest.Parse(arguments) is { } request) window.HandleExternal(request);
                    else window.OpenFromAnotherStart(null);
                });
                // Thirteen.exe --quit (the uninstaller, or setup replacing the files): close as the user would.
                instance.QuitRequested += () => Dispatcher.UIThread.Post(window.Close);
            }
            if (SmokeCommand.UiSmokeRequested) ArmUiSmoke(desktop, window);
        }
        base.OnFrameworkInitializationCompleted();
    }

    /// <summary>
    /// The events services of this run (§6.4): created here only, never by the UI tests, so a test never reads or writes
    /// <c>%LOCALAPPDATA%\Thirteen\Calendars</c>. The calendars load on a background thread; a file or link given on the
    /// command line opens its dialog once the window is shown.
    /// </summary>
    private static void StartEvents(IClassicDesktopStyleApplicationLifetime desktop, MainWindow window, LaunchOptions options)
    {
        var accent = (window.DataContext as MainViewModel)?.State.Theme.Palette(dark: false).Accent;
        var events = EventsHost.Create(options, accent is { } color ? $"#{color.R:x2}{color.G:x2}{color.B:x2}" : null);
        window.Events = events;
        if (window.DataContext is MainViewModel model) AttachEvents(model, events);
        _ = events.StartAsync();
        desktop.Exit += (_, _) => events.Dispose();
        if (options.External is { } request) window.Opened += (_, _) => Dispatcher.UIThread.Post(() => window.HandleExternal(request));
    }

    /// <summary>
    /// Gives the window's model the events of <paramref name="events"/>: the Calendar section, the Calendars pane in the
    /// navigation pane, and (tasks W9) Today and the day details. The UI tests do the same over the mockup data set.
    /// </summary>
    public static void AttachEvents(MainViewModel model, EventsHost events)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(events);
        var clock = (events.Store as EventStoreBase)?.Clock;
        model.AttachEvents(
            new EventsModel(events.Store, events.Subscriptions, events.Pending),
            new CalendarsPaneViewModel(events.Store, events.Subscriptions, clock));
    }

    /// <summary>The main window and its model for <paramref name="options"/> (also used by the UI tests).</summary>
    public MainWindow CreateMainWindow(LaunchOptions options, ISettingsStore store)
    {
        Themes ??= new ThemeService(this);
        Func<GregorianDate>? clock = options.Today is { } fixedToday ? () => fixedToday : null;
        var state = new AppState(store, Themes, clock);
        if (options.Theme is { } theme) state.Theme = theme;
        if (options.Mode is { } mode) state.Appearance = mode;
        if (options.System is { } system) state.System = system;
        if (options.TextScale is { } scale) state.TextScale = scale;
        else if (Support.TextScaling.ReadSystem() is { } systemScale) state.TextScale = systemScale;
        FollowsSystemContrast = options.HighContrast is null;
        Themes.HighContrast = options.HighContrast ?? SystemHighContrast();
        state.ApplyTheme();

        var model = new MainViewModel(state);
        if (options.Year is { } year)
        {
            model.CalendarPage.SetYear(year);
            model.ComparePage.Year = year;
        }
        if (options.Link is { } link) model.Open(link);
        if (options.Route is { } route) model.Open(route);
        if (options.Page is { } page) model.Section = page;
        if (options.CalendarMode is { } calendarMode)
        {
            if (options.Page is null && options.Route is null && options.Link is null) model.Section = AppSection.Calendar;
            model.CalendarPage.Mode = calendarMode;
        }
        if (options.Select is { } select)
        {
            if (options.Year is null) model.CalendarPage.Date = select;
            model.ShowDetail(select);
            model.CalendarPage.YearMode.Reveal(select);
        }

        var window = new MainWindow { DataContext = model, FollowsSystemTextScale = options.TextScale is null };
        if (options.Width is null && options.Height is null) window.Restore(state.WindowPlacement);
        if (options.Width is { } width) window.Width = width;
        if (options.Height is { } height) window.Height = height;
        if (options.Maximized) window.WindowState = WindowState.Maximized;
        return window;
    }

    /// <summary>--scroll top|center|bottom: where the visible page starts scrolled (screenshots).</summary>
    private static void ScrollPages(Window window, string where) => Dispatcher.UIThread.Post(() =>
    {
        foreach (var scroller in window.GetVisualDescendants().OfType<ScrollViewer>().Where(s => s.Name == "Scroller" && s.IsEffectivelyVisible))
        {
            var max = Math.Max(0, scroller.Extent.Height - scroller.Viewport.Height);
            scroller.Offset = new Vector(0, where switch { "bottom" => max, "center" => max / 2, _ => 0 });
        }
    }, DispatcherPriority.Background);

    /// <summary>--smoke-ui: report what the window shows once it has rendered, then exit.</summary>
    private static void ArmUiSmoke(IClassicDesktopStyleApplicationLifetime desktop, MainWindow window)
    {
        var timeout = new DispatcherTimer(TimeSpan.FromSeconds(30), DispatcherPriority.Background, (_, _) =>
        {
            SmokeCommand.EnsureStdout();
            Console.Out.WriteLine("UI smoke: the main window did not render within 30 seconds");
            Console.Out.Flush();
            ExitSoon(desktop, 1);
        });
        timeout.Start();
        window.Opened += (_, _) => DispatcherTimer.RunOnce(() =>
        {
            timeout.Stop();
            SmokeCommand.EnsureStdout();
            var texts = window.GetVisualTextBlocks().Where(t => !string.IsNullOrWhiteSpace(t)).ToArray();
            Console.Out.WriteLine($"UI smoke: window \"{window.Title}\" rendered at {window.Bounds.Width:0}x{window.Bounds.Height:0}, {texts.Length} text blocks");
            foreach (var text in texts) Console.Out.WriteLine($"  {text}");
            if (SmokeCommand.ScreenshotPath is { } path)
            {
                var scaling = window.RenderScaling;
                var size = new PixelSize((int)Math.Ceiling(window.Bounds.Width * scaling), (int)Math.Ceiling(window.Bounds.Height * scaling));
                using var bitmap = new RenderTargetBitmap(size, new Vector(96 * scaling, 96 * scaling));
                bitmap.Render(window);
                bitmap.Save(path);
                Console.Out.WriteLine($"UI smoke: saved {size.Width}x{size.Height} screenshot to {path}");
            }
            Console.Out.Flush();
            ExitSoon(desktop, 0);
        }, TimeSpan.FromMilliseconds(600), DispatcherPriority.Background);
    }

    /// <summary>
    /// Shuts down normally, with a watchdog: without an interactive desktop (an SSH session runs in
    /// session 0) ANGLE's Direct3D swap chain cannot be created and closing the window can stall, so the
    /// diagnostic run must not depend on a clean shutdown to report its exit code.
    /// </summary>
    private static void ExitSoon(IClassicDesktopStyleApplicationLifetime desktop, int exitCode)
    {
        new Thread(() =>
        {
            Thread.Sleep(TimeSpan.FromSeconds(5));
            Environment.Exit(exitCode);
        }) { IsBackground = true, Name = "UI smoke watchdog" }.Start();
        desktop.Shutdown(exitCode);
    }
}

internal static class VisualTextExtensions
{
    /// <summary>The text of every visible TextBlock in the window, in visual tree order.</summary>
    public static IEnumerable<string> GetVisualTextBlocks(this Window window) =>
        window.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible).Select(t => t.Text ?? "");
}
