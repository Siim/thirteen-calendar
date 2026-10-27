namespace Thirteen.Core.Tests;

/// <summary>
/// DisplayText.WithoutDashes must give the same words as the Apple apps' Phrasing.withoutDashes
/// (apple/Shared/Support/Phrasing.swift): ranges read "to", a spaced dash becomes a comma, any other
/// dash a hyphen. Dashes are written as escapes so this file holds none.
/// </summary>
public sealed class DisplayTextTests
{
    [Theory]
    [InlineData("skipping 3\u201313 September.", "skipping 3 to 13 September.")]
    [InlineData("1920s\u20131930s", "1920s-1930s")] // "s" precedes the dash: not a numeric range
    [InlineData("from 1928 \u2013 1989", "from 1928 to 1989")]
    [InlineData("28\u201431 days", "28 to 31 days")]
    [InlineData("Sol \u2013 the sun month", "Sol, the sun month")]
    [InlineData("Sol \u2014 the sun month", "Sol, the sun month")]
    [InlineData("well\u2013known", "well-known")]
    [InlineData("A\u2014B", "A-B")]
    [InlineData("no dashes - here", "no dashes - here")]
    [InlineData("", "")]
    public void WithoutDashes_MatchesThePhrasingRules(string input, string expected)
    {
        var actual = DisplayText.WithoutDashes(input);
        Assert.Equal(expected, actual);
        Assert.True(actual.IndexOfAny(['\u2013', '\u2014']) < 0);
    }

    [Fact]
    public void WithoutDashes_ReturnsTheSameInstance_WhenThereIsNothingToReplace()
    {
        const string text = "Thursday, October 12, 2026";
        Assert.Same(text, DisplayText.WithoutDashes(text));
        Assert.Throws<ArgumentNullException>(() => DisplayText.WithoutDashes(null!));
    }
}
