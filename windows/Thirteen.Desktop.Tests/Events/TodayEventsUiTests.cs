using Avalonia;
using Avalonia.Automation.Peers;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Themes;
using Thirteen.Desktop.ViewModels;
using Thirteen.Desktop.Views;
using Thirteen.Desktop.Views.Events;
using Thirteen.Desktop.Views.Parts;
using Xunit.Abstractions;
using CalendarMode = Thirteen.Desktop.ViewModels.CalendarMode;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// Task W9 in the real window on the headless platform with the mockup data set (now 2026-10-19T09:41 in Tallinn):
/// Today's Up next (§2.8), the day details' Events section (§2.9), Settings' Calendar rows (§2.18) and the always-dark
/// Appearance note, the text size (§2.20), and the Import dialog opened by a file from the command line (§2.17). Set
/// THIRTEEN_TEST_SCREENSHOTS to a folder to save what they render.
/// </summary>
public class TodayEventsUiTests(ITestOutputHelper output)
{
    private static (MainWindow Window, MainViewModel Model, List<string> Requests) Open(IEventStore? events = null, params string[] args)
    {
        var options = LaunchOptions.Parse([.. args, "--fake-events", "--width", "1440", "--height", "900"]);
        var window = ((App)Application.Current!).CreateMainWindow(options, new MemorySettingsStore());
        var model = (MainViewModel)window.DataContext!;
        var store = events as EventStoreBase ?? new FakeEventStore();
        if (!store.IsLoaded) store.LoadAsync().GetAwaiter().GetResult();
        var host = new EventsHost(store, new SubscriptionService(store, time: store.Clock), refreshes: false);
        App.AttachEvents(model, host);
        var actions = new PlaceholderCalendarActions();
        var requests = new List<string>();
        actions.Requested += requests.Add;
        model.CalendarPage.Actions = actions;
        window.Show();
        Settle();
        return (window, model, requests);
    }

    private static void Settle()
    {
        for (var i = 0; i < 4; i++) Dispatcher.UIThread.RunJobs();
    }

    /// <summary>Runs the UI thread's jobs until <paramref name="done"/> holds (work on the thread pool included), or fails after 10 seconds.</summary>
    private static async Task Pump(Func<bool> done, string what)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (!done())
        {
            if (DateTime.UtcNow > deadline) Assert.Fail($"Timed out waiting for: {what}");
            Dispatcher.UIThread.RunJobs();
            await Task.Delay(10);
        }
        Settle();
    }

    private static string? Name(Control control) => ControlAutomationPeer.CreatePeerForElement(control).GetName();

    private static List<string> Texts(Visual root) =>
        root.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible && !string.IsNullOrEmpty(t.Text)).Select(t => t.Text!).ToList();

    private static void Save(Window window, string name)
    {
        if (Environment.GetEnvironmentVariable("THIRTEEN_TEST_SCREENSHOTS") is not { Length: > 0 } folder) return;
        Directory.CreateDirectory(folder);
        window.CaptureRenderedFrame()?.Save(Path.Combine(folder, name));
    }

    private static void NoDashes(IEnumerable<string> texts)
    {
        foreach (var text in texts)
        {
            Assert.DoesNotContain('–', text);
            Assert.DoesNotContain('—', text);
        }
    }

    // ---- Today: Up next (§2.8) --------------------------------------------------------------------------

    [AvaloniaFact]
    public void UpNext_ShowsTheMockupWeek_WithTheRunningEventsNowPlate()
    {
        var (window, model, _) = Open(null, "--page", "today");
        Save(window, "windows-today-up-next.png");
        var upNext = model.TodayPage.UpNext;
        Assert.True(upNext.IsVisible);
        foreach (var group in upNext.Groups)
        {
            output.WriteLine($"{group.Heading} | {group.Caption}");
            foreach (var row in group.Rows) output.WriteLine($"   {row.Row.TimeText} | {row.Row.Title} | {row.Row.SubText} | now={row.IsNow} | {row.Row.AutomationName}");
        }
        output.WriteLine(upNext.MoreText);

        // Board B1 of docs/EVENTS.md: today from 09:41, then tomorrow, six rows and the rest summarized.
        Assert.Equal(["Today", "Tomorrow"], upNext.Groups.Select(g => g.Heading).ToArray());
        Assert.Equal(
            [
                ("All day", "Autumn school break", "Day 1 of 7"),
                ("09:30", "Sprint planning", "until 10:30"),
                ("11:00", "1:1 with Marta", "until 11:30"),
                ("15:40", "Dentist, Dr. Tamm", "Tartu mnt 18"),
                ("19:00", "Book club: Cotsworth", "Raamatukoi"),
                ("07:15", "Yoga", "until 08:15"),
            ],
            upNext.Groups.SelectMany(g => g.Rows).Select(r => (r.Row.TimeText, r.Row.Title, r.Row.SubText)).ToArray());
        Assert.Equal("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", upNext.Groups[0].Rows[3].Row.AutomationName);
        Assert.Equal("5 more in the next 7 days", upNext.MoreText);
        Assert.Equal(UpNextViewModel.MaxRows, upNext.Groups.Sum(g => g.Rows.Count));
        var today = upNext.Groups[0].Rows;
        var running = Assert.Single(upNext.Groups.SelectMany(g => g.Rows), r => r.IsNow);
        Assert.Equal("Sprint planning", running.Row.Title);
        Assert.Equal("Now", running.ItemStatus);
        // A running event leads the timed rows (all-day items come first, in the agenda's order).
        Assert.Equal(running, today.First(r => !r.Row.Item.AllDay));
        Assert.DoesNotContain(today, r => r.Row.Item.End.CompareTo(new LocalDateTime(new GregorianDate(2026, 10, 19), 9 * 60 + 41)) <= 0);
        Assert.True(upNext.HasMore);
        Assert.Matches("^[0-9]+ more in the next 7 days$", upNext.MoreText);

        // The card on screen: under the hero, with its title, "+" and "Show all in Calendar".
        var card = window.GetVisualDescendants().OfType<UpNextCard>().Single();
        Assert.True(card.IsEffectivelyVisible);
        var texts = Texts(card);
        Assert.Contains("Up next", texts);
        Assert.Contains("Today", texts);
        Assert.Contains("Now", texts);
        Assert.Contains("Sprint planning", texts);
        Assert.Contains(upNext.MoreText, texts);
        var showAll = card.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "UpNextShowAll");
        Assert.Equal("Show all in Calendar", Name(showAll));
        var plus = card.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "UpNextNewEvent");
        Assert.Equal("New event", Name(plus));
        NoDashes(texts);
        NoDashes(card.GetVisualDescendants().OfType<Control>().Select(Name).OfType<string>());
    }

    [AvaloniaFact]
    public void UpNext_ShowAllOpensListOnToday_AndPlusAsksForANewEventToday()
    {
        var (_, model, requests) = Open(null, "--page", "today");
        model.TodayPage.UpNext.ShowAllCommand.Execute(null);
        Settle();
        Assert.Equal(AppSection.Calendar, model.CurrentPage.Section);
        Assert.Equal(CalendarMode.List, model.CalendarPage.Mode);
        Assert.Equal(model.State.Today, model.CalendarPage.Date);

        model.TodayPage.UpNext.NewEventCommand.Execute(null);
        Settle();
        output.WriteLine(string.Join(" / ", requests));
        Assert.NotEmpty(requests);
        Assert.Contains(requests, r => r.Contains("2026-10-19", StringComparison.Ordinal));
    }

    [AvaloniaFact]
    public void UpNext_IsHidden_UntilACalendarHoldsAnEvent()
    {
        using var folder = new TempFolder();
        using var store = StoreTesting.Store(folder);
        store.LoadAsync().GetAwaiter().GetResult();
        var (window, model, _) = Open(store, "--page", "today");
        Assert.False(model.TodayPage.UpNext.IsVisible);
        Assert.False(window.GetVisualDescendants().OfType<UpNextCard>().Single().IsEffectivelyVisible);

        // An event next week: the card appears, "Nothing else today." over the later day.
        StoreTesting.Put(store, store.Calendars[0].Id, StoreTesting.Timed("later", "Choir", "2026-10-22T18:00", "2026-10-22T20:00")).GetAwaiter().GetResult();
        Settle();
        var upNext = model.TodayPage.UpNext;
        Assert.True(upNext.IsVisible);
        Assert.True(upNext.ShowsEmptyToday);
        Assert.Equal("Nothing else today.", upNext.EmptyTodayText);
        var group = Assert.Single(upNext.Groups);
        Assert.NotNull(group.Caption);
        Assert.StartsWith("Gregorian ", group.Caption, StringComparison.Ordinal);
        Assert.Equal("Choir", Assert.Single(group.Rows).Row.Title);
    }

    // ---- The day details' Events section (§2.9) -----------------------------------------------------------

    [AvaloniaFact]
    public void DayDetail_ListsTheDaysEvents_AndOpensItInCalendar()
    {
        var (window, model, _) = Open(null, "--page", "today");
        model.ShowDetail(new GregorianDate(2026, 10, 19));
        Settle();
        Save(window, "windows-day-detail-events.png");
        var events = model.Detail!.Events;
        Assert.True(events.IsVisible);
        Assert.True(events.HasRows);
        Assert.Contains(events.Rows, r => r.Row.Title == "Sprint planning" && r.IsNow);
        var view = window.GetVisualDescendants().OfType<DayEventsView>().Single();
        var texts = Texts(view);
        Assert.Contains("EVENTS", texts);
        Assert.Contains("Sprint planning", texts);
        NoDashes(texts);

        // Another day: no Now plate there.
        model.ShowDetail(new GregorianDate(2026, 10, 20));
        Settle();
        Assert.DoesNotContain(model.Detail!.Events.Rows, r => r.IsNow);

        model.Detail!.Events.OpenInCalendarCommand.Execute(null);
        Settle();
        Assert.False(model.HasDetail);
        Assert.Equal(AppSection.Calendar, model.CurrentPage.Section);
        Assert.Equal(CalendarMode.Day, model.CalendarPage.Mode);
        Assert.Equal(new GregorianDate(2026, 10, 20), model.CalendarPage.Date);
    }

    [AvaloniaFact]
    public void DayDetail_ADayWithoutEvents_SaysNoEvents()
    {
        using var folder = new TempFolder();
        using var store = StoreTesting.Store(folder);
        store.LoadAsync().GetAwaiter().GetResult();
        var (window, model, _) = Open(store, "--page", "today");
        model.ShowDetail(new GregorianDate(2026, 10, 20));
        Settle();
        var events = model.Detail!.Events;
        Assert.False(events.HasRows);
        Assert.True(events.ShowsEmpty);
        Assert.Contains("No events.", Texts(window.GetVisualDescendants().OfType<DayEventsView>().Single()));
    }

    // ---- Settings (§2.18) and the always-dark Appearance note ---------------------------------------------------

    [AvaloniaFact]
    public void Settings_CalendarRows_SetTheDefaultCalendarAndYearDots()
    {
        var (window, model, _) = Open(null, "--page", "settings");
        var settings = model.SettingsPage;
        var section = window.GetVisualDescendants().OfType<Border>().Single(b => b.Name == "CalendarSettings");
        Save(window, "windows-settings-calendar.png");
        var texts = Texts(section);
        output.WriteLine(string.Join(" / ", texts));
        Assert.Contains("Default calendar", texts);
        Assert.Contains("Show events in Year view", texts);
        Assert.Contains("Thirteen schedules alerts for the next 60 days each time it runs.", texts);
        Assert.Contains("Your events are saved on this computer.", texts);
        NoDashes(texts);

        var writable = model.Events!.Store.Calendars.Where(c => c.IsWritable).Select(c => c.Name).ToArray();
        Assert.Equal(writable, settings.DefaultCalendars.Select(c => c.Name).ToArray());
        var second = settings.DefaultCalendars[1];
        settings.SelectedDefaultCalendar = second;
        Settle();
        Assert.Equal(second.Id, model.State.DefaultCalendarId);
        Assert.Equal($"New events go to {second.Name}.", settings.DefaultCalendarFooter);
        Assert.Contains(settings.DefaultCalendarFooter, Texts(section));

        var dots = model.State.ShowsYearEvents;
        var toggle = section.GetVisualDescendants().OfType<ToggleSwitch>().Single(t => t.Name == "YearDotsSwitch");
        toggle.IsChecked = !dots;
        Settle();
        Assert.Equal(!dots, model.State.ShowsYearEvents);
        Assert.Equal("Show events in Year view", Name(toggle));
    }

    [AvaloniaFact]
    public async Task Settings_ExportAll_OpensTheExportDialogWithEveryCalendar()
    {
        var (window, model, _) = Open(null, "--page", "settings");
        model.SettingsPage.ExportAllCommand.Execute(null);
        await Pump(() => window.OwnedWindows.OfType<ExportDialog>().Any(), "the Export dialog");
        var dialog = window.OwnedWindows.OfType<ExportDialog>().Single();
        var vm = (ExportDialogViewModel)dialog.DataContext!;
        Assert.Equal(model.Events!.Store.Calendars.Count, vm.Chosen.Count);
        Assert.True(vm.ShowsSecretLinks == model.Events.Store.Calendars.Any(c => c.IsSubscription));
        vm.CancelCommand.Execute(null);
        Settle();
        Assert.Empty(window.OwnedWindows.OfType<ExportDialog>());
    }

    [AvaloniaFact]
    public void Settings_AlwaysDarkTheme_DisablesAppearance_ShowsDark_AndKeepsTheSavedChoice()
    {
        var (window, model, _) = Open(null, "--page", "settings");
        model.State.Appearance = AppearanceMode.Light;
        model.State.Theme = Themes.ThirteenTheme.Phosphor;
        Settle();
        var appearance = window.GetVisualDescendants().OfType<ItemsControl>().Single(i => Name(i) == "Appearance");
        Save(window, "windows-settings-always-dark.png");
        Assert.False(appearance.IsEnabled);
        var radios = appearance.GetVisualDescendants().OfType<RadioButton>().ToArray();
        Assert.All(radios, r => Assert.False(r.IsEffectivelyEnabled));
        Assert.Equal("Dark", Assert.Single(radios, r => r.IsChecked == true).Content);
        Assert.Contains("Phosphor is always dark. Pick a light and dark theme to use Appearance again.", Texts(window));
        Assert.Equal(AppearanceMode.Light, model.State.Appearance);

        model.State.Theme = Themes.ThirteenTheme.Almanac;
        Settle();
        Assert.True(appearance.IsEnabled);
        Assert.Equal("Light", Assert.Single(appearance.GetVisualDescendants().OfType<RadioButton>(), r => r.IsChecked == true).Content);
    }

    // ---- Text size (§2.20) -------------------------------------------------------------------------------------

    [AvaloniaFact]
    public async Task TextScale_GrowsText_ButNotIcons_AndReachesDialogs()
    {
        var (window, model, _) = Open(null, "--page", "today");
        var title = window.GetVisualDescendants().OfType<UpNextCard>().Single().GetVisualDescendants().OfType<TextBlock>().First(t => t.Text == "Up next");
        var normal = title.FontSize;
        var icon = window.GetVisualDescendants().OfType<TextBlock>().FirstOrDefault(t => t.Classes.Contains("icon"));
        var iconSize = icon?.FontSize;
        model.State.TextScale = 1.5;
        Settle();
        Assert.Equal(1.5, TextScaling.GetScale(window));
        Assert.Equal(Math.Round(normal * 1.5, 2), title.FontSize);
        if (icon is not null) Assert.Equal(iconSize, icon.FontSize);

        model.SettingsPage.ExportAllCommand.Execute(null);
        await Pump(() => window.OwnedWindows.OfType<ExportDialog>().Any(), "the Export dialog");
        var dialog = window.OwnedWindows.OfType<ExportDialog>().Single();
        Assert.Equal(1.5, TextScaling.GetScale(dialog));
        ((ExportDialogViewModel)dialog.DataContext!).CancelCommand.Execute(null);

        model.State.TextScale = 1;
        Settle();
        Assert.Equal(normal, title.FontSize);
        Assert.Equal(1, TextScaling.Clamp(0.5));
        Assert.Equal(2.25, TextScaling.Clamp(4));
        Assert.Equal(1, TextScaling.Clamp(double.NaN));
    }

    // ---- Import from the command line and the result toast (§2.17) ------------------------------------------

    [AvaloniaFact]
    public async Task ImportFile_FromTheCommandLine_OpensTheImportDialog_AndTheToastShowsTheResult()
    {
        using var folder = new TempFolder();
        using var store = StoreTesting.Store(folder);
        await store.LoadAsync();
        var (window, model, _) = Open(store, "--page", "calendar");
        var file = RepoPaths.Fixture("ics", "cases", "missing-uid.ics");
        // As Thirteen.exe "C:\path\missing-uid.ics" (or a second start handing the file over) asks.
        var request = ExternalRequest.Parse([file]);
        Assert.NotNull(request);
        window.HandleExternal(request!);
        await Pump(() => window.OwnedWindows.OfType<ImportDialog>().Any(), "the Import dialog");
        var dialog = window.OwnedWindows.OfType<ImportDialog>().Single();
        Save(dialog, "windows-import-dialog.png");
        var vm = (ImportDialogViewModel)dialog.DataContext!;
        Assert.Equal("Import events", Name(dialog));
        var row = Assert.Single(vm.Rows.OfType<ImportSourceRow>());
        Assert.Equal("New calendar: Bookings", row.SelectedTarget.Label);
        var texts = Texts(dialog);
        Assert.Contains("2 events in missing-uid.ics", texts);
        NoDashes(texts);
        var import = vm.ImportCommand.ExecuteAsync(null);
        await Pump(() => import.IsCompleted && !window.ImportExport.IsBusy, "the import");
        Assert.Empty(window.OwnedWindows.OfType<ImportDialog>());
        Assert.Equal("Added 2, updated 0, unchanged 0.", window.NoticeToast.Text);
        Assert.True(window.NoticeToast.IsVisible);
        Assert.Contains(model.Events!.Store.Calendars, c => c.Name == "Bookings" && c.EventCount == 2);
    }
}
