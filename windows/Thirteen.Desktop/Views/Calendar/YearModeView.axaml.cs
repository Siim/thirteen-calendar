using Avalonia;
using Avalonia.Controls;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Core;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>Calendar's Year mode: brings a day's month into view and focuses the day when the view model asks.</summary>
public partial class YearModeView : UserControl
{
    private YearViewModel? _model;

    /// <summary>Creates the view.</summary>
    public YearModeView()
    {
        InitializeComponent();
        DataContextChanged += (_, _) =>
        {
            if (_model is not null) _model.RevealRequested -= OnRevealRequested;
            _model = DataContext as YearViewModel;
            if (_model is not null) _model.RevealRequested += OnRevealRequested;
            RevealPending();
        };
        AttachedToVisualTree += (_, _) => RevealPending();
    }

    private void OnRevealRequested(object? sender, GregorianDate date) => RevealPending();

    // Reveals requested before the view existed or was attached (e.g. "Show in Year", --select) wait in the model.
    private void RevealPending()
    {
        if (_model is null || this.GetVisualRoot() is null) return;
        if (_model.TakePendingReveal() is { } date) Reveal(date);
    }

    /// <summary>Scrolls the day's month card to the top and focuses the day (after layout).</summary>
    public void Reveal(GregorianDate date) => Reveal(date, attempts: 4);

    private void Reveal(GregorianDate date, int attempts)
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (_model is null) return;
            var months = _model.Content.Months;
            var index = months.ToList().FindIndex(m => m.Contains(date));
            if (index < 0) return;
            var card = Months.ContainerFromIndex(index) as Control;
            var top = card?.TranslatePoint(new Point(0, 0), Scroller.Content as Visual ?? Scroller);
            if (top is null || Scroller.Extent.Height <= 0)
            {
                // Not laid out yet (first visit): try again after the next layout pass.
                if (attempts > 0) Reveal(date, attempts - 1);
                return;
            }
            // Focus first: ScrollViewer scrolls a newly focused descendant into view on its own, and the
            // card-to-top offset set afterwards must win.
            DayNavigation.Focus(Months, dc => dc switch
            {
                DayCellViewModel cell => cell.Date == date,
                IntercalaryBadgeModel badge => badge.Date == date,
                _ => false,
            }, bringIntoView: false);
            Scroller.Offset = new Vector(Scroller.Offset.X, Math.Max(0, top.Value.Y - 8));
        }, DispatcherPriority.Loaded);
    }
}
