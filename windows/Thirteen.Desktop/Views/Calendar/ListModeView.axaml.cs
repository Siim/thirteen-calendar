using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Thirteen.Core;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>
/// Calendar's List mode: keeps the sticky month header on the month of the first row on screen, loads the next year
/// near the end of the list and the year before when scrolled up past its start (keeping the rows on screen where they
/// were), and starts at the top when the Calendar's day changes.
/// </summary>
public partial class ListModeView : UserControl
{
    /// <summary>How close to the end (in pixels) the next year loads.</summary>
    public const double LoadMargin = 600;

    private ListModeViewModel? _model;
    private GregorianDate? _anchor;
    private bool _loading;

    private readonly DispatcherTimer _clock = new() { Interval = TimeSpan.FromSeconds(30) };

    /// <summary>Creates the view.</summary>
    public ListModeView()
    {
        InitializeComponent();
        // The "Now" plate follows the clock (board J2).
        _clock.Tick += (_, _) => (DataContext as ListModeViewModel)?.RefreshNow();
        AttachedToVisualTree += (_, _) => _clock.Start();
        DetachedFromVisualTree += (_, _) => _clock.Stop();
        Scroller.ScrollChanged += (_, e) =>
        {
            UpdateSticky();
            if (e.OffsetDelta.Y < 0 && Scroller.Offset.Y <= 0) LoadEarlier();
            else LoadLaterIfNear();
        };
        // At the very top a wheel turn or Page Up changes no offset, so ScrollChanged does not fire.
        Scroller.AddHandler(PointerWheelChangedEvent, (_, e) =>
        {
            if (e.Delta.Y > 0 && Scroller.Offset.Y <= 0) LoadEarlier();
        }, RoutingStrategies.Tunnel);
        Scroller.AddHandler(KeyDownEvent, (_, e) =>
        {
            if (e.Key is Key.PageUp or Key.Up && Scroller.Offset.Y <= 0 && e.KeyModifiers == KeyModifiers.None) LoadEarlier();
        }, RoutingStrategies.Tunnel);
        DataContextChanged += (_, _) =>
        {
            if (_model is not null) _model.PropertyChanged -= OnModelChanged;
            _model = DataContext as ListModeViewModel;
            if (_model is not null) _model.PropertyChanged += OnModelChanged;
            _anchor = _model?.Anchor;
        };
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(ListModeViewModel.Rows) || _model is null) return;
        var anchor = _model.Anchor;
        if (anchor != _anchor && !_loading)
        {
            // A new day (paging, Today, a deep link): the list starts at it again.
            _anchor = anchor;
            Scroller.Offset = default;
        }
        Dispatcher.UIThread.Post(UpdateSticky, DispatcherPriority.Loaded);
    }

    private void LoadLaterIfNear()
    {
        if (_model is not { CanLoadLater: true } || _loading) return;
        if (Scroller.Extent.Height <= 0 || Scroller.Offset.Y + Scroller.Viewport.Height < Scroller.Extent.Height - LoadMargin) return;
        _loading = true;
        try
        {
            _model.LoadLater();
        }
        finally
        {
            _loading = false;
        }
    }

    private void LoadEarlier()
    {
        if (_model is not { CanLoadEarlier: true } || _loading) return;
        var before = Scroller.Extent.Height;
        _loading = true;
        bool added;
        try
        {
            added = _model.LoadEarlier();
        }
        finally
        {
            _loading = false;
        }
        if (!added) return;
        // Keep what was on screen in place: move down by what was added above it.
        Dispatcher.UIThread.Post(() =>
        {
            var grown = Scroller.Extent.Height - before;
            if (grown > 0) Scroller.Offset = new Vector(0, Scroller.Offset.Y + grown);
        }, DispatcherPriority.Loaded);
    }

    /// <summary>The month header in force at the top of the viewport, shown while its own row has scrolled away.</summary>
    private void UpdateSticky()
    {
        if (_model is null || Rows.ItemCount == 0 || Scroller.Offset.Y <= 0)
        {
            StickyHeader.IsVisible = false;
            return;
        }
        var top = Scroller.Offset.Y;
        int low = 0, high = Rows.ItemCount - 1, first = 0;
        while (low <= high)
        {
            var mid = (low + high) / 2;
            if (Rows.ContainerFromIndex(mid) is not Control container) break;
            var y = container.TranslatePoint(new Point(0, 0), Scroller.Content as Visual ?? Scroller)?.Y ?? 0;
            if (y + container.Bounds.Height <= top)
            {
                low = mid + 1;
            }
            else
            {
                first = mid;
                high = mid - 1;
            }
        }
        var header = _model.MonthHeaderAt(first);
        StickyHeader.IsVisible = header is not null;
        StickyText.Text = header?.Text;
    }
}
