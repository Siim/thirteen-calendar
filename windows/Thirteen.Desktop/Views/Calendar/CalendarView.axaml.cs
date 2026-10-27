using Avalonia.Controls;
using Avalonia.Input;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.CalendarSection;

/// <summary>The Calendar section's page (see the XAML).</summary>
public partial class CalendarView : UserControl
{
    /// <summary>Creates the view.</summary>
    public CalendarView()
    {
        InitializeComponent();
        // The drag toast's timeout pauses while the pointer is over it or focus is inside it (§2.11 "Toast timing").
        MoveToast.PointerEntered += (_, _) => Toast?.Pause(true);
        MoveToast.PointerExited += (_, _) => Toast?.Pause(MoveToast.IsKeyboardFocusWithin);
        MoveToast.GotFocus += (_, _) => Toast?.Pause(true);
        MoveToast.LostFocus += (_, _) => Toast?.Pause(MoveToast.IsPointerOver);
    }

    private MoveToastViewModel? Toast => (DataContext as CalendarViewModel)?.Mover.Toast;
}
