using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Threading;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// A <see cref="ChoiceQuestion"/> as a dialog (§2.11): one full-width button per choice in order (the accent or the
/// destructive style as asked), Cancel last; Escape and the close button are Cancel. The result is the chosen
/// button's index, or null.
/// </summary>
public partial class ChoiceDialog : EventDialogWindow
{
    /// <summary>For the XAML loader.</summary>
    public ChoiceDialog()
        : this(new ChoiceQuestion("", null, [], [], ""))
    {
    }

    /// <summary>Asks <paramref name="question"/>.</summary>
    public ChoiceDialog(ChoiceQuestion question)
    {
        ArgumentNullException.ThrowIfNull(question);
        InitializeComponent();
        DataContext = question;
        Question = question;
        Button? first = null;
        for (var i = 0; i < question.Choices.Count; i++)
        {
            var choice = question.Choices[i];
            var index = i;
            var button = MakeButton(choice.Text);
            if (choice.Style == ChoiceStyle.Accent) button.Classes.Add("accent");
            if (choice.Style == ChoiceStyle.Destructive) button.Classes.Add("destructive");
            button.Click += (_, _) => Close(index);
            Buttons.Children.Add(button);
            first ??= button;
        }
        var cancel = MakeButton(question.CancelText);
        cancel.Name = "CancelButton";
        cancel.IsCancel = true;
        cancel.Click += (_, _) => Close(null);
        Buttons.Children.Add(cancel);
        // The safe button has the focus: the first choice for a question with several, Cancel for a destructive one.
        var focus = question.Choices.Count > 0 && question.Choices[0].Style != ChoiceStyle.Destructive ? first! : cancel;
        Opened += (_, _) => Dispatcher.UIThread.Post(() => focus.Focus(NavigationMethod.Tab));
        KeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape) return;
            e.Handled = true;
            Close(null);
        };
    }

    /// <summary>The question shown.</summary>
    public ChoiceQuestion Question { get; }

    private static Button MakeButton(string text)
    {
        var button = new Button
        {
            Content = text,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            MinHeight = 32,
        };
        AutomationProperties.SetName(button, text);
        return button;
    }
}
