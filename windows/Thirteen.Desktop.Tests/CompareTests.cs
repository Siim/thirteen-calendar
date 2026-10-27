using Avalonia;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Thirteen.Desktop.Controls;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Tests;

/// <summary>The Compare screen's charts read the engine's month names, as the Apple charts do.</summary>
public class CompareTests
{
    // The month-length bars cut "Saint Paul" to "Sai" (and "S" when narrow) while the ribbon above them,
    // the year progress bar and the Apple charts use the engine's short name, "Pau".
    [AvaloniaFact]
    public void BarsUseTheShortMonthNamesOfTheRibbon()
    {
        var window = ((App)Application.Current!).CreateMainWindow(
            LaunchOptions.Parse(["--page", "compare", "--system", "positivist", "--date", "2026-10-19", "--width", "1400", "--height", "900"]),
            new MemorySettingsStore());
        window.Show();
        Dispatcher.UIThread.RunJobs();
        var charts = window.GetVisualDescendants().OfType<MonthLengthChart>().ToDictionary(c => c.Name!);
        Assert.Equal("Pau", charts["ThirteenChart"].ShortNames![5]);
        Assert.Equal("Saint Paul", charts["ThirteenChart"].Names![5]);   // the readout keeps the full name
        Assert.Equal(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], charts["GregorianChart"].ShortNames!);
        window.Close();
    }
}
