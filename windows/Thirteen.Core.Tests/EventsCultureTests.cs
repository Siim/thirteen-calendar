using System.Globalization;
using System.Reflection;
using Thirteen.Core.Tests.Support;
using Xunit.Abstractions;

namespace Thirteen.Core.Tests;

/// <summary>
/// The events engine is culture-invariant (docs/EVENTS.md §5.7, task W1): every section of fixtures/events.json
/// is replayed again with the thread's culture set to cultures that break culture-sensitive code, and must
/// give the same results. sv-SE writes negative numbers with U+2212 and decimals with a comma; tr-TR maps
/// i to U+0130 when upper-casing; th-TH, ar-SA and fa-IR format dates in the Thai Buddhist, Umm al-Qura and
/// Persian calendars. Formatting, parsing, casing, comparing and sorting in the engine are all ordinal or
/// invariant, so none of these may change a result.
/// </summary>
public sealed class EventsCultureTests(ITestOutputHelper output)
{
    public static TheoryData<string> Cultures => ["sv-SE", "tr-TR", "th-TH", "ar-SA", "fa-IR"];

    /// <summary>The section replays of <see cref="EventsFixtureParityTests"/>, one per section of the file.</summary>
    private static readonly MethodInfo[] SectionReplays = typeof(EventsFixtureParityTests).GetMethods()
        .Where(m => m.Name.StartsWith("Section_", StringComparison.Ordinal) && m.GetCustomAttributes(typeof(FactAttribute), false).Length > 0)
        .OrderBy(m => m.Name, StringComparer.Ordinal)
        .ToArray();

    [Fact]
    public void TheCultures_BreakCultureSensitiveCode()
    {
        Assert.Equal("\u0130", "i".ToUpper(CultureInfo.GetCultureInfo("tr-TR")));
        Assert.Equal(",", CultureInfo.GetCultureInfo("sv-SE").NumberFormat.NumberDecimalSeparator);
        Assert.IsType<ThaiBuddhistCalendar>(CultureInfo.GetCultureInfo("th-TH").Calendar);
        Assert.IsType<UmAlQuraCalendar>(CultureInfo.GetCultureInfo("ar-SA").Calendar);
        Assert.IsType<PersianCalendar>(CultureInfo.GetCultureInfo("fa-IR").Calendar);
        Assert.Equal(EventsFixture.Sections.Length, SectionReplays.Length);
    }

    [Theory]
    [MemberData(nameof(Cultures))]
    public void EverySection_ReplaysTheSame_UnderCulture(string name)
    {
        var culture = CultureInfo.GetCultureInfo(name);
        var parity = new EventsFixtureParityTests(output);
        var failures = new List<string>();
        var (savedCulture, savedUiCulture) = (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture);
        try
        {
            CultureInfo.CurrentCulture = culture;
            CultureInfo.CurrentUICulture = culture;
            foreach (var replay in SectionReplays)
            {
                try
                {
                    replay.Invoke(parity, null);
                }
                catch (TargetInvocationException error) when (error.InnerException is not null)
                {
                    failures.Add($"{replay.Name}: {error.InnerException.Message}");
                }
            }
        }
        finally
        {
            CultureInfo.CurrentCulture = savedCulture;
            CultureInfo.CurrentUICulture = savedUiCulture;
        }
        output.WriteLine($"{name} ({culture.Calendar.GetType().Name}, minus sign U+{(int)culture.NumberFormat.NegativeSign[0]:X4}): {SectionReplays.Length} section replays, {failures.Count} failed");
        Assert.True(failures.Count == 0, $"Under {name}:\n{string.Join("\n", failures)}");
    }
}
