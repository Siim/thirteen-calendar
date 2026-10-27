using System.Diagnostics;
using Thirteen.Core;

namespace Thirteen.Desktop.ViewModels;

/// <summary>
/// What the Calendar views ask for and task W7 provides (docs/EVENTS.md §6.4 W7): the details flyout, the editor on a
/// new or existing event, Delete with its span dialog, Duplicate as an unsaved draft, and Undo / Redo. The views of task
/// W5 (Year, Month, List) and W6 (Week, Day) call these through <see cref="CalendarViewModel.Actions"/>; nothing here
/// writes to the store. The <c>anchor</c> parameters are the control the request came from (a chip, a cell, a
/// row), for a flyout to point at and for focus to return to (§2.20 "Focus after actions"); null for keyboard shortcuts
/// with nothing focused.
/// </summary>
public interface ICalendarActions
{
    /// <summary>Double-click or Enter on an item: its details flyout (§2.10).</summary>
    void ShowDetails(CalendarItem item, object? anchor);

    /// <summary>
    /// "New event" (toolbar, Ctrl+N, a cell's double-click or menu, the <c>new-event</c> route): the editor on an unsaved
    /// draft on <paramref name="date"/> from <paramref name="startMinute"/> to <paramref name="endMinute"/> (minutes of the
    /// day; both null for an all-day draft). Nothing is stored until Add (§2.4).
    /// </summary>
    void NewEvent(GregorianDate date, int? startMinute, int? endMinute, object? anchor);

    /// <summary>Ctrl+E on the selected event: the editor (the caller has checked that it can be edited).</summary>
    void Edit(CalendarItem item, object? anchor);

    /// <summary>Delete on the selected event or an item's menu: the delete question or span dialog (§2.10, §2.11).</summary>
    void Delete(CalendarItem item, object? anchor);

    /// <summary>An item's "Duplicate" (or an Alt-drag, task W6): the editor on an unsaved copy on <paramref name="date"/> (its own day when null).</summary>
    void Duplicate(CalendarItem item, GregorianDate? date, int? startMinute, object? anchor);

    /// <summary>Ctrl+Z: undoes the last move, delete or save of this window (§2.11).</summary>
    void Undo();

    /// <summary>Ctrl+Y: redoes it.</summary>
    void Redo();

    /// <summary>
    /// The details of <paramref name="item"/> (§2.10) with their Edit, Delete event and More actions, for the regular-width
    /// Day details panel (§2.6); null while the event actions are not there.
    /// </summary>
    Events.EventDetailsViewModel? DetailsFor(CalendarItem item) => null;

    /// <summary>Whether the window's undo history has a change to undo (Ctrl+Z then acts in every section, §2.11).</summary>
    bool CanUndo => false;

    /// <summary>Whether it has a change to redo.</summary>
    bool CanRedo => false;
}

/// <summary>
/// The actions until task W7 attaches its own (<see cref="CalendarViewModel.Actions"/>): each request is only logged
/// (Trace), so the views can be built, tested and screenshot before the editor exists. Tests record the requests
/// through <see cref="Requested"/>.
/// </summary>
public sealed class PlaceholderCalendarActions : ICalendarActions
{
    /// <summary>Raised with a short description of each request ("details work/sprint-planning|...").</summary>
    public event Action<string>? Requested;

    private void Log(string text)
    {
        Trace.WriteLine($"Thirteen: calendar action not available yet (task W7): {text}");
        Requested?.Invoke(text);
    }

    /// <inheritdoc />
    public void ShowDetails(CalendarItem item, object? anchor) => Log($"details {item.Key}");

    /// <inheritdoc />
    public void NewEvent(GregorianDate date, int? startMinute, int? endMinute, object? anchor) =>
        Log($"new {date.ToIsoString()} {startMinute?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "all-day"}");

    /// <inheritdoc />
    public void Edit(CalendarItem item, object? anchor) => Log($"edit {item.Key}");

    /// <inheritdoc />
    public void Delete(CalendarItem item, object? anchor) => Log($"delete {item.Key}");

    /// <inheritdoc />
    public void Duplicate(CalendarItem item, GregorianDate? date, int? startMinute, object? anchor) => Log($"duplicate {item.Key}");

    /// <inheritdoc />
    public void Undo() => Log("undo");

    /// <inheritdoc />
    public void Redo() => Log("redo");
}
