using Avalonia.Controls;
using Avalonia.Threading;

namespace Thirteen.Desktop.Views.Events;

/// <summary>
/// The window's result toast (§2.17 step 4): <see cref="Show"/> puts a sentence at the bottom of the window, read
/// politely by Narrator (a live region); it goes after <see cref="Duration"/> or with its Close button. A newer sentence
/// replaces the one shown.
/// </summary>
public partial class NoticeToast : UserControl
{
    private readonly DispatcherTimer _timer;

    /// <summary>Creates the toast (hidden).</summary>
    public NoticeToast()
    {
        InitializeComponent();
        _timer = new DispatcherTimer { Interval = Duration };
        _timer.Tick += (_, _) => Hide();
        CloseButton.Click += (_, _) => Hide();
    }

    /// <summary>How long a toast stays.</summary>
    public static TimeSpan Duration { get; } = TimeSpan.FromSeconds(10);

    /// <summary>The sentence shown, or null.</summary>
    public string? Text => IsVisible ? Message.Text : null;

    /// <summary>Shows <paramref name="text"/>.</summary>
    public void Show(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        Message.Text = text;
        IsVisible = true;
        _timer.Stop();
        _timer.Interval = Duration;
        _timer.Start();
    }

    /// <summary>Hides the toast.</summary>
    public void Hide()
    {
        _timer.Stop();
        IsVisible = false;
    }
}
