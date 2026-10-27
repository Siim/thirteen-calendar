using Thirteen.Core.Tests.Support;

namespace Thirteen.Core.Tests;

/// <summary>
/// Files the Windows app ships that must stay in step with the rest of the repository.
/// </summary>
public sealed class RepositoryAssetsTests
{
    /// <summary>
    /// One icon everywhere (design/DECISIONS.md): the app and installer icon is the design system's
    /// Windows export of the shared "Page 13" artwork, byte for byte. Fix a failure with
    /// <c>sh windows/Thirteen.Desktop/Assets/sync-icon.sh</c>.
    /// </summary>
    [Fact]
    public void WindowsIcon_IsTheDesignSystemExport()
    {
        var root = Fixture.RepositoryRoot();
        var export = Path.Combine(root, "design", "icon", "exports", "windows", "Thirteen.ico");
        var shipped = Path.Combine(root, "windows", "Thirteen.Desktop", "Assets", "Thirteen.ico");
        Assert.True(File.Exists(export), $"Missing {export}");
        Assert.True(File.Exists(shipped), $"Missing {shipped}");
        Assert.True(
            File.ReadAllBytes(export).AsSpan().SequenceEqual(File.ReadAllBytes(shipped)),
            $"{shipped} differs from {export}: run windows/Thirteen.Desktop/Assets/sync-icon.sh");
    }
}
