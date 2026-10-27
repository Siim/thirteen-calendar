using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Threading;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.Views.Events;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>
/// The span question of a drag edit (§2.11): <see cref="AskAsync"/> shows <see cref="MovePlan.Question"/> over a window
/// and returns the chosen <see cref="MoveChoice"/>, or null for Cancel or Escape. Cancel has the focus, so Enter never
/// moves a series by accident.
/// </summary>
public partial class MoveSpanDialog : EventDialogWindow
{
    /// <summary>For the XAML loader.</summary>
    public MoveSpanDialog()
        : this(new MovePlan.Question(MoveStrings.SpanTitle, MoveStrings.MoveMessage, [], []))
    {
    }

    /// <summary>The dialog of <paramref name="question"/>.</summary>
    public MoveSpanDialog(MovePlan.Question question)
    {
        ArgumentNullException.ThrowIfNull(question);
        InitializeComponent();
        Question = question;
        AutomationProperties.SetName(this, question.Title);
        TitleText.Text = question.Title;
        Message.Text = question.Message;
        Message.IsVisible = question.Message.Length > 0;
        Lines.ItemsSource = question.Lines;
        Lines.IsVisible = question.Lines.Count > 0;
        foreach (var choice in question.Choices)
        {
            var button = new Button
            {
                Content = choice.Label,
                MinWidth = 96,
                Margin = new Avalonia.Thickness(8, 0, 0, 8),
                HorizontalContentAlignment = HorizontalAlignment.Center,
            };
            button.Classes.Add(choice.Destructive ? "destructive" : "accent");
            AutomationProperties.SetName(button, choice.Label);
            var chosen = choice;
            button.Click += (_, _) => Close(chosen);
            Buttons.Children.Add(button);
        }
        CancelButton = new Button
        {
            Content = MoveStrings.Cancel,
            MinWidth = 96,
            Margin = new Avalonia.Thickness(8, 0, 0, 8),
            HorizontalContentAlignment = HorizontalAlignment.Center,
            IsCancel = true,
        };
        AutomationProperties.SetName(CancelButton, MoveStrings.Cancel);
        CancelButton.Click += (_, _) => Close(null);
        Buttons.Children.Add(CancelButton);
        KeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape) return;
            Close(null);
            e.Handled = true;
        };
        Opened += (_, _) => Dispatcher.UIThread.Post(() => CancelButton.Focus());
    }

    /// <summary>The question shown.</summary>
    public MovePlan.Question Question { get; }

    /// <summary>The Cancel button.</summary>
    public Button CancelButton { get; }

    /// <summary>The choice buttons in order, then Cancel.</summary>
    public IReadOnlyList<Button> ChoiceButtons => Buttons.Children.OfType<Button>().ToArray();

    /// <summary>The span question over the window of <paramref name="view"/> (<see cref="ViewModels.EventMover.Ask"/>).</summary>
    public static Func<MovePlan.Question, object?, Task<MoveChoice?>> AskOver(Control view)
    {
        ArgumentNullException.ThrowIfNull(view);
        return (question, _) => TopLevel.GetTopLevel(view) is Window owner ? AskAsync(owner, question) : Task.FromResult<MoveChoice?>(null);
    }

    /// <summary>Asks <paramref name="question"/> over <paramref name="owner"/>: the chosen choice, or null.</summary>
    public static async Task<MoveChoice?> AskAsync(Window owner, MovePlan.Question question)
    {
        ArgumentNullException.ThrowIfNull(owner);
        var dialog = new MoveSpanDialog(question);
        return await dialog.ShowDialog<MoveChoice?>(owner).ConfigureAwait(true);
    }
}
