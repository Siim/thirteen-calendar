using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.Events;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The Calendars pane, the Subscribe dialog, the calendar settings and the confirmation on the headless platform with
/// <see cref="FakeEventStore"/>: what they show, their accessible names (§2.20), the no-dashes text walk (§2.19) and a
/// subscribe link handed to the main window. Set THIRTEEN_TEST_SCREENSHOTS to a folder to save what they render.
/// </summary>
public class CalendarsUiTests
{
    private static FakeEventStore LoadedFake()
    {
        var store = new FakeEventStore();
        store.LoadAsync().GetAwaiter().GetResult();
        return store;
    }

    private static Window Host(Control content, double width = 320, double height = 860)
    {
        var window = new Window { Width = width, Height = height, Content = content };
        window.Show();
        Dispatcher.UIThread.RunJobs();
        return window;
    }

    /// <summary>Every visible text, accessible name, help text and tooltip under <paramref name="root"/>.</summary>
    internal static List<string> Texts(Visual root)
    {
        var texts = new List<string>();
        if (root is Window window && window.Title is { } title) texts.Add(title);
        foreach (var control in root.GetVisualDescendants().OfType<Control>().Where(c => c.IsEffectivelyVisible))
        {
            texts.AddRange(new[]
            {
                (control as TextBlock)?.Text,
                (control as TextBox)?.Text,
                (control as TextBox)?.Watermark,
                AutomationProperties.GetName(control),
                AutomationProperties.GetHelpText(control),
                ToolTip.GetTip(control) as string,
            }.OfType<string>().Where(t => t.Length > 0));
        }
        return texts;
    }

    internal static void AssertNoDashes(IEnumerable<string> texts, string where)
    {
        foreach (var text in texts) Assert.False(text.Contains('–') || text.Contains('—'), $"{where}: \"{text}\"");
    }

    private static string? Name(Control control) => ControlAutomationPeer.CreatePeerForElement(control).GetName();

    private static void Save(Window window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    [AvaloniaFact]
    public void ThePaneShowsBothGroupsTheRowsAndTheFooter()
    {
        var store = LoadedFake();
        using var model = new CalendarsPaneViewModel(store, null, store.Clock);
        var pane = new CalendarsPane { DataContext = model };
        var window = Host(pane);
        Save(window, "calendars-pane.png");

        var texts = window.GetVisualTextBlocks().Where(t => t.Length > 0).ToList();
        foreach (var expected in new[]
                 {
                     "On this computer", "Subscriptions", "Hide all", "Home", "Family", "Work", "Running club", "Holidays in Estonia",
                     "Birthdays", "Updated 10 min ago", "New calendar", "Subscribe to calendar", "Import .ics file", "Export",
                     "Your events are saved on this computer.",
                 })
        {
            Assert.Contains(expected, texts);
        }
        Assert.DoesNotContain("Open folder", texts);           // the mockup data set has no folder
        Assert.DoesNotContain(model.OfflineText, texts);
        AssertNoDashes(Texts(window), "Calendars pane");

        // §2.20: every row control is named; the checkbox says the calendar and its status.
        var boxes = window.GetVisualDescendants().OfType<CheckBox>().ToList();
        Assert.Equal(
            ["Home", "Family", "Work", "Running club", "Holidays in Estonia, Updated 10 min ago", "Birthdays, Updated 10 min ago"],
            boxes.Select(Name));
        var buttons = window.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyVisible).ToList();
        Assert.All(buttons, b => Assert.False(string.IsNullOrEmpty(Name(b)), "a button without a name"));
        Assert.Contains("Calendar settings, Holidays in Estonia", buttons.Select(Name));
        Assert.Contains("Color, Orange", buttons.Select(Name));
        Assert.Contains("On this computer", buttons.Select(Name));
        Assert.Equal("Calendars", AutomationProperties.GetName(pane));

        // Import and Export are disabled until their flow exists (task W8).
        Assert.False(buttons.Single(b => Name(b) == "Import .ics file").IsEffectivelyEnabled);
        Assert.True(buttons.Single(b => Name(b) == "New calendar").IsEffectivelyEnabled);
        window.Close();
    }

    [AvaloniaFact]
    public void CollapsingAGroupShowsItsCountAndHidingACalendarUnchecksIt()
    {
        var store = LoadedFake();
        using var model = new CalendarsPaneViewModel(store, null, store.Clock);
        var window = Host(new CalendarsPane { DataContext = model });

        var header = window.GetVisualDescendants().OfType<Button>().Single(b => Name(b) == "On this computer");
        header.Command!.Execute(null);
        Dispatcher.UIThread.RunJobs();
        var texts = window.GetVisualTextBlocks().ToList();
        Assert.Contains("4 calendars, 4 shown", texts);
        Assert.DoesNotContain("Home", texts);
        Assert.Equal("On this computer, 4 calendars, 4 shown", Name(header));

        var box = window.GetVisualDescendants().OfType<CheckBox>().First(b => b.IsEffectivelyVisible);
        Assert.Equal("Holidays in Estonia, Updated 10 min ago", Name(box));
        box.IsChecked = false;
        for (var i = 0; i < 100 && !window.GetVisualTextBlocks().Contains("Show all"); i++)
        {
            Thread.Sleep(20);
            Dispatcher.UIThread.RunJobs();
        }
        Assert.False(store.Find("holidays")!.Visible);
        Assert.Contains("Show all", window.GetVisualTextBlocks());
        Save(window, "calendars-pane-collapsed.png");
        window.Close();
    }

    [AvaloniaFact]
    public void TheOfflineBannerAndAFailedFeedRead()
    {
        using var folder = new TempFolder();
        var time = new FixedTimeProvider(StoreTesting.Now);
        using var store = StoreTesting.Store(folder, time);
        store.LoadAsync().GetAwaiter().GetResult();
        store.CreateSubscriptionAsync("Running club", "#0d9488", new SubscriptionRecord
        {
            Url = "https://calendars.example.com/run.ics",
            LastSuccessAt = "2026-10-19T04:41:00.000Z",
            LastError = "subscribe.error.denied",
        }, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Feed//EN\r\nEND:VCALENDAR\r\n").GetAwaiter().GetResult();
        var network = new TestNetwork();
        using var service = new SubscriptionService(store, network, time);
        using var model = new CalendarsPaneViewModel(store, service, time);
        var window = Host(new CalendarsPane { DataContext = model });
        var texts = window.GetVisualTextBlocks().ToList();
        Assert.Contains("Couldn't update. The server refused access. The link may be private or expired.", texts);
        Assert.Contains("Open folder", texts);                  // the storage line of the file store
        Assert.Contains(window.GetVisualDescendants().OfType<Button>(), b => b.IsEffectivelyVisible && Name(b) == "Try again");
        Save(window, "calendars-pane-error.png");

        network.IsAvailable = false;
        Dispatcher.UIThread.RunJobs();
        texts = window.GetVisualTextBlocks().ToList();
        Assert.Contains("You're offline. Subscriptions update when you're back online.", texts);
        Assert.Contains("Updated 2 hours ago", texts);
        Assert.DoesNotContain("Couldn't update. The server refused access. The link may be private or expired.", texts);
        AssertNoDashes(Texts(window), "offline pane");
        Save(window, "calendars-pane-offline.png");
        window.Close();
    }

    [AvaloniaFact]
    public async Task TheSubscribeDialogChecksTheLinkThenAsksForNameColorAndUpdate()
    {
        var store = LoadedFake();
        var handler = new StubFeedHandler(SubscribeDialogTests.Feed(112));
        using var service = new SubscriptionService(store, new TestNetwork(), store.Clock, handler);
        var model = new SubscribeDialogViewModel(service, store, "webcal://calendars.example.com/holidays-ee.ics");
        var owner = Host(new Panel(), 900, 700);
        var dialog = new SubscribeDialog { DataContext = model };
        dialog.Show(owner);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal("Subscribe to a calendar", Name(dialog));   // the window's name; its title bar has no text
        Assert.Equal("webcal://calendars.example.com/holidays-ee.ics", dialog.GetVisualDescendants().OfType<TextBox>().First().Text);
        Assert.Empty(handler.Seen);
        var texts = dialog.GetVisualTextBlocks().ToList();
        Assert.Contains("Calendar link", texts);
        Assert.Contains(EventStrings.SubscribeHelp, texts);
        AssertNoDashes(Texts(dialog), "Subscribe dialog");
        Save(dialog, "subscribe-link.png");

        await model.SubscribeCommand.ExecuteAsync(null);
        Dispatcher.UIThread.RunJobs();
        texts = dialog.GetVisualTextBlocks().ToList();
        Assert.Contains("Holidays in Estonia: 112 events", texts);
        Assert.Contains("Name", texts);
        Assert.Contains("Color", texts);
        Assert.Contains("Update", texts);
        Assert.DoesNotContain("Calendar link", texts);
        var interval = dialog.GetVisualDescendants().OfType<ComboBox>().Single();
        Assert.Equal("Every day", ((IntervalOption)interval.SelectedItem!).Label);
        Assert.Equal("Update", Name(interval));
        var colors = dialog.GetVisualDescendants().OfType<ListBox>().Single();
        Assert.Equal("Color", Name(colors));
        Assert.Equal(11, colors.ItemCount);
        var buttons = dialog.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyVisible).Select(Name).ToList();
        Assert.Equal(["Cancel", "Subscribe"], buttons);
        AssertNoDashes(Texts(dialog), "Subscribe dialog, found");
        Save(dialog, "subscribe-found.png");

        CalendarState? added = null;
        model.Finished += state => added = state;
        await model.SubscribeCommand.ExecuteAsync(null);
        Assert.NotNull(added);
        Assert.Equal("Holidays in Estonia", added!.Name);
        dialog.Close();
        owner.Close();
    }

    [AvaloniaFact]
    public async Task ASubscribeErrorShowsUnderTheField()
    {
        var store = LoadedFake();
        using var service = new SubscriptionService(store, new TestNetwork(), store.Clock, new StubFeedHandler("<html></html>"));
        var model = new SubscribeDialogViewModel(service, store, "calendars.example.com");
        var owner = Host(new Panel(), 900, 700);
        var dialog = new SubscribeDialog { DataContext = model };
        dialog.Show(owner);
        Dispatcher.UIThread.RunJobs();
        await model.SubscribeCommand.ExecuteAsync(null);
        Dispatcher.UIThread.RunJobs();
        Assert.Contains("Enter a link that starts with webcal://, https:// or http://.", dialog.GetVisualTextBlocks());
        model.Link = "https://calendars.example.com/page.html";
        await model.SubscribeCommand.ExecuteAsync(null);
        Dispatcher.UIThread.RunJobs();
        Assert.Contains("This link doesn't lead to a calendar.", dialog.GetVisualTextBlocks());
        Assert.DoesNotContain("Enter a link that starts with webcal://, https:// or http://.", dialog.GetVisualTextBlocks());
        Save(dialog, "subscribe-error.png");
        dialog.Close();
        owner.Close();
    }

    [AvaloniaFact]
    public void TheSettingsOfASubscriptionAndOfALocalCalendar()
    {
        var store = LoadedFake();
        var owner = Host(new Panel(), 900, 700);
        var subscription = new CalendarSettingsDialog { DataContext = new CalendarSettingsViewModel(store, null, "holidays") };
        subscription.Show(owner);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal("Calendar settings", Name(subscription));
        var names = subscription.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyVisible).Select(Name).ToList();
        Assert.Equal(["Update now", "Unsubscribe", "Close"], names);
        Assert.Contains("Calendar link", subscription.GetVisualTextBlocks());
        AssertNoDashes(Texts(subscription), "subscription settings");
        Save(subscription, "settings-subscription.png");
        subscription.Close();

        var local = new CalendarSettingsDialog { DataContext = new CalendarSettingsViewModel(store, null, "work") };
        local.Show(owner);
        Dispatcher.UIThread.RunJobs();
        names = local.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyVisible).Select(Name).ToList();
        Assert.Equal(["Export", "Delete calendar", "Close"], names);
        Assert.DoesNotContain("Calendar link", local.GetVisualTextBlocks());
        Assert.Equal("Work", local.GetVisualDescendants().OfType<TextBox>().Single().Text);
        AssertNoDashes(Texts(local), "local settings");
        local.Close();
        owner.Close();
    }

    [AvaloniaFact]
    public void TheConfirmationGoesAheadOnlyWithItsAction()
    {
        var owner = Host(new Panel(), 900, 700);
        var message = EventStrings.UnsubscribeMessage("Holidays in Estonia");
        var dialog = new ConfirmDialog(message, EventStrings.Unsubscribe);
        var result = dialog.ShowDialog<bool>(owner);
        Dispatcher.UIThread.RunJobs();
        Assert.Contains(message, dialog.GetVisualTextBlocks());
        var buttons = dialog.GetVisualDescendants().OfType<Button>().ToList();
        Assert.Equal(["Cancel", "Unsubscribe"], buttons.Select(Name));
        AssertNoDashes(Texts(dialog), "confirmation");
        buttons[1].RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Dispatcher.UIThread.RunJobs();
        Assert.True(result.IsCompleted);
        Assert.True(result.Result);

        var cancelled = new ConfirmDialog(message, EventStrings.Unsubscribe);
        var second = cancelled.ShowDialog<bool>(owner);
        Dispatcher.UIThread.RunJobs();
        cancelled.GetVisualDescendants().OfType<Button>().First().RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Dispatcher.UIThread.RunJobs();
        Assert.True(second.IsCompleted);
        Assert.False(second.Result);
        owner.Close();
    }

    [AvaloniaFact]
    public void ASubscribeLinkHandedToTheWindowOpensTheDialogPrefilledWithoutFetching()
    {
        var store = LoadedFake();
        var handler = new StubFeedHandler(SubscribeDialogTests.Feed(2));
        var events = new EventsHost(store, new SubscriptionService(store, new TestNetwork(), store.Clock, handler), refreshes: false);
        var options = LaunchOptions.Parse(["--date", "2026-10-19", "--width", "1280", "--height", "860"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        window.Events = events;
        window.Show();
        Dispatcher.UIThread.RunJobs();

        var request = ExternalRequest.Parse(["webcal://calendars.example.com/holidays-ee.ics"])!;
        window.HandleExternal(request);
        Dispatcher.UIThread.RunJobs();
        var dialog = Assert.Single(window.OwnedWindows.OfType<SubscribeDialog>());
        Assert.Equal("webcal://calendars.example.com/holidays-ee.ics", ((SubscribeDialogViewModel)dialog.DataContext!).Link);
        Assert.Empty(handler.Seen);

        window.HandleExternal(request);                // a second link while the dialog is open does not stack a second one
        Dispatcher.UIThread.RunJobs();
        Assert.Single(window.OwnedWindows.OfType<SubscribeDialog>());
        ((SubscribeDialogViewModel)dialog.DataContext!).CancelCommand.Execute(null);
        Dispatcher.UIThread.RunJobs();
        Assert.Empty(window.OwnedWindows.OfType<SubscribeDialog>());
        window.Close();
        events.Dispose();
    }
}
