namespace Thirteen.Desktop.Services;

/// <summary>
/// The calendar new events go to (docs/EVENTS.md §2.15 "Default calendar", §2.18): the one chosen in Settings while it
/// exists and can be written, else the platform default, "Personal" (the first local calendar in the list); with no local
/// calendar left, "Personal" is created again on the next "+" (<see cref="IEventStore.EnsureLocalCalendarAsync"/>). The
/// editor (task W7), the Import dialog's default target and Settings' footer all read it from here.
/// </summary>
public static class DefaultCalendar
{
    /// <summary>The calendar new events go to now, or null when there is no writable local calendar (one is created on the next "+").</summary>
    public static CalendarState? Resolve(IEventStore store, string? chosenId)
    {
        ArgumentNullException.ThrowIfNull(store);
        var writable = store.Calendars.Where(c => c.IsWritable).ToArray();
        return writable.FirstOrDefault(c => c.Id == chosenId) ?? writable.FirstOrDefault();
    }

    /// <summary>The name new events go to: the resolved calendar's, or "Personal" (created on the next "+").</summary>
    public static string NameOf(IEventStore store, string? chosenId) => Resolve(store, chosenId)?.Name ?? EventStoreBase.PersonalName;

    /// <summary>Resolves, creating "Personal" again when no local calendar is left (§2.16).</summary>
    public static async Task<CalendarState> EnsureAsync(IEventStore store, string? chosenId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        return Resolve(store, chosenId) ?? await store.EnsureLocalCalendarAsync(cancellationToken).ConfigureAwait(false);
    }
}
