using Thirteen.Core.Events;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels.Events;

/// <summary>A question and what each of its buttons does.</summary>
/// <param name="Question">The question.</param>
/// <param name="Spans">The span of each button, in order.</param>
public sealed record SpanQuestion(ChoiceQuestion Question, IReadOnlyList<EditSpan> Spans);

/// <summary>
/// The questions of §2.11 before a save or delete of an event: the span question of a repeating event (with the losses
/// said before the choice: <c>span.future.exceptionsDropped</c> from <see cref="EventRecurrence.Split"/> or
/// <see cref="EventRecurrence.Retime"/>, <c>span.deletesLater</c> when the repeat becomes Never), the <c>editable: false</c>
/// variants (<c>span.keep.*</c>, "Save for all events"), the rule-changed variant, the delete confirmations and the
/// discard questions.
/// </summary>
public static class SpanQuestions
{
    /// <summary>
    /// The question before saving <paramref name="draft"/> on an occurrence of a repeating event opened as
    /// <paramref name="original"/>.
    /// </summary>
    public static SpanQuestion ForSave(ResolvedEvent resolved, EventDraft original, EventDraft draft)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        ArgumentNullException.ThrowIfNull(original);
        ArgumentNullException.ThrowIfNull(draft);
        var ruleChanged = !Equals(original.Recurrence, draft.Recurrence);
        var lines = new List<string>();
        int Dropped() => resolved.IsFirst ? EventEditing.RetimeDropped(resolved, draft) : EventEditing.FutureDropped(resolved, original, draft);

        if (!resolved.RepeatEditable && !ruleChanged)
        {
            // Repeats set in another app (editable: false): this event, or all events in place; a new date: this event only.
            var dateMoved = draft.Start.Date != original.Start.Date;
            if (dateMoved)
            {
                return new SpanQuestion(
                    new ChoiceQuestion(EditorStrings.SpanTitle, EditorStrings.SpanKeepDateMessage, lines, [new Choice(EditorStrings.SpanSaveThis, ChoiceStyle.Accent)], EditorStrings.Cancel),
                    [EditSpan.This]);
            }
            return new SpanQuestion(
                new ChoiceQuestion(EditorStrings.SpanTitle, EditorStrings.SpanKeepMessage, lines,
                    [new Choice(EditorStrings.SpanSaveThis), new Choice(EditorStrings.SpanSaveAll, ChoiceStyle.Accent)], EditorStrings.Cancel),
                [EditSpan.This, EditSpan.All]);
        }

        var dropped = Dropped();
        if (dropped > 0) lines.Add(EditorStrings.SpanExceptionsDropped(dropped));
        if (ruleChanged)
        {
            var destructive = false;
            if (draft.Recurrence is null && original.Recurrence is not null)
            {
                var later = EventEditing.LaterCount(resolved);
                if (later is null) lines.Add(EditorStrings.SpanDeletesLaterEndless);
                else if (later > 0) lines.Add(EditorStrings.SpanDeletesLater(later.Value));
                destructive = later is null || later > 0;
            }
            return new SpanQuestion(
                new ChoiceQuestion(EditorStrings.SpanTitle, EditorStrings.SpanRuleChangedMessage, lines,
                    [new Choice(EditorStrings.SpanSaveFuture, destructive ? ChoiceStyle.Destructive : ChoiceStyle.Accent)], EditorStrings.Cancel),
                [EditSpan.Future]);
        }
        return new SpanQuestion(
            new ChoiceQuestion(EditorStrings.SpanTitle, EditorStrings.SpanSaveMessage, lines,
                [new Choice(EditorStrings.SpanSaveThis), new Choice(EditorStrings.SpanSaveFuture, ChoiceStyle.Accent)], EditorStrings.Cancel),
            [EditSpan.This, EditSpan.Future]);
    }

    /// <summary>The delete question (§2.11): "Delete this event?" for a single event, the span question for an occurrence of a series.</summary>
    public static SpanQuestion ForDelete(bool repeating)
    {
        if (!repeating)
        {
            return new SpanQuestion(
                new ChoiceQuestion(EditorStrings.DeleteSingleTitle, null, [], [new Choice(EditorStrings.DeleteSingleButton, ChoiceStyle.Destructive)], EditorStrings.Cancel),
                [EditSpan.All]);
        }
        return new SpanQuestion(
            new ChoiceQuestion(EditorStrings.SpanTitle, EditorStrings.DeleteRepeatingMessage, [],
                [new Choice(EditorStrings.DeleteRepeatingThis, ChoiceStyle.Destructive), new Choice(EditorStrings.DeleteRepeatingFuture, ChoiceStyle.Destructive)], EditorStrings.Cancel),
            [EditSpan.This, EditSpan.Future]);
    }

    /// <summary>The question before closing a changed draft (§2.11): a new event's or an edit's.</summary>
    public static ChoiceQuestion Discard(bool newEvent) => newEvent
        ? new ChoiceQuestion(EditorStrings.DiscardNewTitle, null, [], [new Choice(EditorStrings.DiscardNewButton, ChoiceStyle.Destructive)], EditorStrings.DiscardKeep)
        : new ChoiceQuestion(EditorStrings.DiscardEditTitle, null, [], [new Choice(EditorStrings.DiscardEditButton, ChoiceStyle.Destructive)], EditorStrings.DiscardKeep);
}
