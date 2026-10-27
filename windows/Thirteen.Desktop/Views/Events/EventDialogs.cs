using Avalonia.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.Events;

/// <summary>Opens the calendar dialogs (§2.15 to §2.17) over a window; shared by the Calendars pane and the main window.</summary>
public static class EventDialogs
{
    /// <summary>The Subscribe dialog, with <paramref name="link"/> prefilled (never fetched before Subscribe is pressed); the new subscription, or null.</summary>
    public static async Task<CalendarState?> SubscribeAsync(Window owner, IEventStore store, SubscriptionService subscriptions, string? link = null)
    {
        var model = new SubscribeDialogViewModel(subscriptions, store, link);
        var dialog = new SubscribeDialog { DataContext = model };
        CalendarState? result = null;
        model.Finished += state =>
        {
            result = state;
            dialog.Close();
        };
        await dialog.ShowDialog(owner);
        return result;
    }

    /// <summary>The New calendar dialog; the new calendar, or null.</summary>
    public static async Task<CalendarState?> NewCalendarAsync(Window owner, IEventStore store)
    {
        var model = new NewCalendarViewModel(store);
        var dialog = new NewCalendarDialog { DataContext = model };
        CalendarState? result = null;
        model.Finished += state =>
        {
            result = state;
            dialog.Close();
        };
        await dialog.ShowDialog(owner);
        return result;
    }

    /// <summary>A calendar's settings (the row's info button).</summary>
    public static async Task SettingsAsync(Window owner, IEventStore store, SubscriptionService? subscriptions, string calendarId, Action<string>? export = null)
    {
        if (store.Find(calendarId) is null) return;
        var model = new CalendarSettingsViewModel(store, subscriptions, calendarId, export);
        var dialog = new CalendarSettingsDialog { DataContext = model };
        model.Confirm = (message, action) => ConfirmAsync(dialog, message, action);
        model.Finished += dialog.Close;
        await dialog.ShowDialog(owner);
    }

    /// <summary>A question with "Cancel" and <paramref name="action"/>; true when the action was chosen.</summary>
    public static async Task<bool> ConfirmAsync(Window owner, string message, string action)
    {
        var dialog = new ConfirmDialog(message, action);
        return await dialog.ShowDialog<bool>(owner);
    }
}
