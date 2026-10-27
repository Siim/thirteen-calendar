using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Controls;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// The window of an events dialog (style class <c>eventDialog</c>): the editor, the repeat pickers, the questions and
/// the calendar dialogs. Its title is drawn once, as the heading in its content (boards D2, G, I1, I2, as on the web),
/// and the title bar keeps only the system close button, so the title and the close control each appear once: the
/// window has no <see cref="Window.Title"/> text. UI Automation still names the window by its title: set
/// <see cref="AutomationProperties.NameProperty"/> on the window, and Narrator announces the dialog by it (§2.20).
/// </summary>
public class EventDialogWindow : Window
{
    /// <summary>Creates the window, with no title text (a window's default title is "Window").</summary>
    public EventDialogWindow() => Title = string.Empty;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DialogPeer(this);

    /// <summary>A window peer named by <see cref="AutomationProperties.NameProperty"/> (the plain window peer reads only <see cref="Window.Title"/>).</summary>
    private sealed class DialogPeer(Window owner) : WindowAutomationPeer(owner)
    {
        protected override string? GetNameCore() =>
            AutomationProperties.GetName(Owner) is { Length: > 0 } name ? name : base.GetNameCore();
    }
}
