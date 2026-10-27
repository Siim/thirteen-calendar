namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>How a question's button looks (§2.11: "Save for future events" takes the destructive style when it deletes).</summary>
public enum ChoiceStyle
{
    /// <summary>A plain button.</summary>
    Normal,

    /// <summary>The accent button (the default action).</summary>
    Accent,

    /// <summary>The destructive button (deletes something).</summary>
    Destructive,
}

/// <summary>One button of a question.</summary>
/// <param name="Text">Its label (§2.19).</param>
/// <param name="Style">Its style.</param>
public sealed record Choice(string Text, ChoiceStyle Style = ChoiceStyle.Normal);

/// <summary>
/// A question with buttons and Cancel (the span questions, delete confirmations and discard questions of §2.11): a title,
/// an optional message, extra lines said before the choice (what would be lost), and the buttons in order. The answer
/// is the index of the chosen button, or null for Cancel (or Escape).
/// </summary>
/// <param name="Title">The title (<c>span.title</c>, <c>delete.single.title</c>, <c>editor.discard.*.title</c>).</param>
/// <param name="Message">The message under it, or null.</param>
/// <param name="Lines">The losses lines (<c>span.future.exceptionsDropped</c>, <c>span.deletesLater</c>), in order.</param>
/// <param name="Choices">The buttons, in order.</param>
/// <param name="CancelText">The cancel button (<c>editor.cancel</c>, or <c>editor.discard.keep</c> for discard questions).</param>
public sealed record ChoiceQuestion(string Title, string? Message, IReadOnlyList<string> Lines, IReadOnlyList<Choice> Choices, string CancelText)
{
    /// <summary>Every text the question shows, for tests and the no-dashes check.</summary>
    public IEnumerable<string> Texts =>
        new[] { Title, Message ?? "" }.Concat(Lines).Concat(Choices.Select(c => c.Text)).Append(CancelText).Where(t => t.Length > 0);
}

/// <summary>
/// The windows, flyouts and alerts of events (docs/EVENTS.md §2.10 to §2.12), so the actions and the editor can be
/// tested without them: <c>Views/Events/WindowEventsUi</c> shows them over the main window; tests script the answers.
/// </summary>
public interface IEventsUi
{
    /// <summary>Shows an event's details (a flyout at <paramref name="anchor"/>, or a dialog at 150 % text and above).</summary>
    void ShowDetails(EventDetailsViewModel details, object? anchor);

    /// <summary>Closes the details, if open (focus goes back to the item that opened them).</summary>
    void CloseDetails();

    /// <summary>Shows the editor as a modal dialog; completes when it closes.</summary>
    Task ShowEditorAsync(EventEditorViewModel editor, object? anchor);

    /// <summary>Asks a question over the editor (when it is open) or the window; the chosen button's index, or null for Cancel.</summary>
    Task<int?> ChooseAsync(ChoiceQuestion question);

    /// <summary>An alert with OK (<c>editor.deletedElsewhere</c>, <c>editor.occurrenceGone</c>).</summary>
    Task AlertAsync(string message);

    /// <summary>The repeat picker (§2.13); true when a row was chosen (the picker sets the editor's repeat).</summary>
    Task<bool> ShowRepeatPickerAsync(RepeatPickerViewModel picker);

    /// <summary>The Custom repeat dialog (§2.13); true when Done was pressed.</summary>
    Task<bool> ShowCustomRepeatAsync(CustomRepeatViewModel custom);

    /// <summary>The list "Changes that couldn't be saved" (§2.11).</summary>
    Task ShowFailedChangesAsync(FailedChangesViewModel list);

    /// <summary>Opens a location in Maps or a URL in the browser (details, §2.10).</summary>
    void Launch(Uri uri);

    /// <summary>Focuses the event's chip, block or row once the views show it (§2.20 "Focus after actions"), best effort.</summary>
    void FocusEvent(string calendarId, string uid);

    /// <summary>
    /// After Delete (§2.20 "Focus after actions"): focus goes to the deleted event's day cell (Month, Week, Day), or in a
    /// list (List mode, Up next, the day lists) to the next row. Called before the views drop the event, best effort.
    /// </summary>
    void FocusAfterDelete(CalendarItem item);
}
