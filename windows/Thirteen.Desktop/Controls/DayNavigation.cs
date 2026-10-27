using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Controls;

/// <summary>
/// Arrow-key navigation between day cells (buttons whose DataContext is an <see cref="INavigableDay"/>)
/// inside a container: Left and Right move to the previous or next day in time (intercalary days
/// included), Up and Down move a week (the cell above or below on the 7-column grid). On a container with
/// <c>SelectOnMove</c> (the converter's day picker) the new day is also picked, like a radio group.
/// <para>
/// A scope is one tab stop, like the Windows calendar: Tab enters it on the day it was left on, or the
/// first time on the selected day, else today, else the first day; arrow keys do the rest. Without this,
/// every day was its own tab stop (365 on the Year screen).
/// </para>
/// </summary>
public static class DayNavigation
{
    /// <summary>Marks a container whose day cells arrow keys move between.</summary>
    public static readonly AttachedProperty<bool> IsScopeProperty =
        AvaloniaProperty.RegisterAttached<Control, bool>("IsScope", typeof(DayNavigation));

    /// <summary>Runs the cell's command when focus moves to it.</summary>
    public static readonly AttachedProperty<bool> SelectOnMoveProperty =
        AvaloniaProperty.RegisterAttached<Control, bool>("SelectOnMove", typeof(DayNavigation));

    // The cell a scope was last focused on (Tab returns to it while it is still shown).
    private static readonly AttachedProperty<Button?> LastFocusedProperty =
        AvaloniaProperty.RegisterAttached<Control, Button?>("LastFocused", typeof(DayNavigation));

    static DayNavigation()
    {
        IsScopeProperty.Changed.AddClassHandler<Control>((control, e) =>
        {
            if (e.NewValue is true)
            {
                control.AddHandler(InputElement.KeyDownEvent, OnKeyDown, RoutingStrategies.Bubble);
                control.AddHandler(InputElement.GotFocusEvent, OnGotFocus, RoutingStrategies.Bubble);
                KeyboardNavigation.SetTabNavigation(control, KeyboardNavigationMode.Once);
            }
            else
            {
                control.RemoveHandler(InputElement.KeyDownEvent, OnKeyDown);
                control.RemoveHandler(InputElement.GotFocusEvent, OnGotFocus);
                control.ClearValue(KeyboardNavigation.TabNavigationProperty);
            }
        });
    }

    /// <summary>The cell Tab should enter a scope on when it has none to return to: selected, today, first.</summary>
    public static Button? EntryCell(Control scope)
    {
        var cells = Cells(scope);
        return cells.FirstOrDefault(c => ((INavigableDay)c.DataContext!).IsSelected)
            ?? cells.FirstOrDefault(c => ((INavigableDay)c.DataContext!).IsToday)
            ?? cells.OrderBy(c => ((INavigableDay)c.DataContext!).NavOrder).FirstOrDefault();
    }

    private static void OnGotFocus(object? sender, GotFocusEventArgs e)
    {
        if (sender is not Control scope) return;
        var cell = (e.Source as Visual)?.FindAncestorOfType<Button>(includeSelf: true);
        if (cell?.DataContext is not INavigableDay) return;
        var last = scope.GetValue(LastFocusedProperty);
        var lastIsShown = last is not null && last.IsEffectivelyVisible && last.DataContext is INavigableDay
            && scope.IsVisualAncestorOf(last);
        if (e.NavigationMethod == NavigationMethod.Tab && !lastIsShown && EntryCell(scope) is { } entry && entry != cell)
        {
            // First Tab into the grid (or its days were rebuilt): start on the selected day or today.
            entry.Focus(NavigationMethod.Tab);
            return;
        }
        scope.SetValue(LastFocusedProperty, cell);
        KeyboardNavigation.SetTabOnceActiveElement(scope, cell);
    }

    /// <summary>Gets <see cref="IsScopeProperty"/>.</summary>
    public static bool GetIsScope(Control control) => control.GetValue(IsScopeProperty);

    /// <summary>Sets <see cref="IsScopeProperty"/>.</summary>
    public static void SetIsScope(Control control, bool value) => control.SetValue(IsScopeProperty, value);

    /// <summary>Gets <see cref="SelectOnMoveProperty"/>.</summary>
    public static bool GetSelectOnMove(Control control) => control.GetValue(SelectOnMoveProperty);

    /// <summary>Sets <see cref="SelectOnMoveProperty"/>.</summary>
    public static void SetSelectOnMove(Control control, bool value) => control.SetValue(SelectOnMoveProperty, value);

    /// <summary>The focusable day cells of a scope, in visual order.</summary>
    public static IReadOnlyList<Button> Cells(Control scope) =>
        scope.GetVisualDescendants().OfType<Button>()
            .Where(b => b.DataContext is INavigableDay && b.IsEffectivelyVisible && b.IsEffectivelyEnabled && b.Focusable)
            .ToArray();

    /// <summary>Focuses the cell whose day is <paramref name="predicate"/>; returns it, or null.</summary>
    /// <param name="scope">The grid or page holding the cells.</param>
    /// <param name="predicate">Matches the cell's model.</param>
    /// <param name="bringIntoView">Scroll the cell into view (off when the caller positions the page itself).</param>
    public static Button? Focus(Control scope, Func<object?, bool> predicate, bool bringIntoView = true)
    {
        var target = Cells(scope).FirstOrDefault(b => predicate(b.DataContext));
        // Directional focus scrolls the focused control into view; the Pointer method does not.
        target?.Focus(bringIntoView ? NavigationMethod.Directional : NavigationMethod.Unspecified);
        if (bringIntoView) target?.BringIntoView();
        return target;
    }

    private static void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Handled || sender is not Control scope || e.KeyModifiers != KeyModifiers.None) return;
        if (e.Key is not (Key.Left or Key.Right or Key.Up or Key.Down)) return;
        var current = (e.Source as Visual)?.FindAncestorOfType<Button>(includeSelf: true);
        if (current?.DataContext is not INavigableDay day) return;

        var cells = Cells(scope);
        Button? target = null;
        switch (e.Key)
        {
            case Key.Left or Key.Right:
            {
                var ordered = cells.OrderBy(c => ((INavigableDay)c.DataContext!).NavOrder).ToArray();
                var index = Array.IndexOf(ordered, current);
                var next = index + (e.Key == Key.Right ? 1 : -1);
                if (index >= 0 && next >= 0 && next < ordered.Length) target = ordered[next];
                break;
            }
            default:
            {
                if (day.NavIndex < 0)
                {
                    // An intercalary day sits outside the grid: up returns to the day before, down to the day after.
                    var ordered = cells.OrderBy(c => ((INavigableDay)c.DataContext!).NavOrder).ToArray();
                    var index = Array.IndexOf(ordered, current);
                    var next = index + (e.Key == Key.Down ? 1 : -1);
                    if (index >= 0 && next >= 0 && next < ordered.Length) target = ordered[next];
                    break;
                }
                var wanted = day.NavIndex + (e.Key == Key.Down ? 7 : -7);
                target = cells.FirstOrDefault(c => ((INavigableDay)c.DataContext!).NavIndex == wanted);
                break;
            }
        }

        e.Handled = true;
        if (target is null) return;
        target.Focus(NavigationMethod.Directional);
        target.BringIntoView();
        if (GetSelectOnMove(scope) && target.Command is { } command && command.CanExecute(target.CommandParameter))
        {
            command.Execute(target.CommandParameter);
            // The picker rebuilds its grid for the new day; keep the focus on the same day.
            var date = (target.DataContext as DayCellViewModel)?.Date;
            Avalonia.Threading.Dispatcher.UIThread.Post(() =>
            {
                if (date is { } d) Focus(scope, dc => dc is DayCellViewModel cell && cell.Date == d);
            }, Avalonia.Threading.DispatcherPriority.Loaded);
        }
    }
}
