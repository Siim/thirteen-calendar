using Thirteen.Core;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels;
using static Thirteen.Desktop.Tests.Dates;

namespace Thirteen.Desktop.Tests;

/// <summary>The sentences of Phrasing.cs, checked against the Apple apps' expectations (apple/Tests/AppModelTests.swift).</summary>
public class PhrasingTests
{
    [Fact]
    public void TodayAnchor()
    {
        var comparison = new Comparison(Day("2026-10-19"), CalendarSystemId.Ifc);
        Assert.Equal("Fixed Thursday, real Monday: the 13-month week runs 3 days ahead of the real one.", Phrasing.WeekdayShift(comparison));
        Assert.Equal("The 13-month label runs 7 days behind: Gregorian October 12 was 7 days ago, a Monday.", Phrasing.LabelDrift(comparison, relativeToToday: true));
        Assert.Equal("7 days behind", Phrasing.DriftAmount(comparison.LabelDrift));
        Assert.Equal("Day 292 of 365", Phrasing.DayOfYear(comparison));
        Assert.Equal("79.7%", Phrasing.Percent(comparison.YearProgress));
        Assert.Equal("73 days until Year Day", Phrasing.Countdown(73, CalendarSystemId.Ifc));
    }

    [Fact]
    public void DriftAhead()
    {
        var comparison = new Comparison(Day("2026-01-29"), CalendarSystemId.Ifc); // IFC February 1
        Assert.Equal(-3, comparison.LabelDrift);
        Assert.Equal("The 13-month label runs 3 days ahead: Gregorian February 1 is 3 days later, a Sunday.", Phrasing.LabelDrift(comparison));
        Assert.Equal("3 days ahead", Phrasing.DriftAmount(-3));
    }

    [Fact]
    public void NoNamesakeAndIntercalary()
    {
        Assert.StartsWith("Sol has no Gregorian namesake", Phrasing.LabelDrift(new Comparison(Day("2026-06-18"), CalendarSystemId.Ifc)));
        Assert.StartsWith("Descartes has no Gregorian namesake", Phrasing.LabelDrift(new Comparison(Day("2026-10-19"), CalendarSystemId.Positivist)));
        var yearDay = new Comparison(Day("2026-12-31"), CalendarSystemId.Ifc);
        Assert.Equal("Year Day belongs to no month, so it has no Gregorian label to compare.", Phrasing.LabelDrift(yearDay));
        Assert.StartsWith("Year Day sits outside the week", Phrasing.WeekdayShift(yearDay));
        Assert.Equal("Today is Festival of All the Dead", Phrasing.Countdown(0, CalendarSystemId.Positivist));
        Assert.Equal("Year Day is tomorrow", Phrasing.Countdown(1, CalendarSystemId.Ifc));
    }

    [Fact]
    public void ShiftAmounts()
    {
        Assert.Equal(
            ["in step", "1 day ahead", "2 days ahead", "3 days ahead", "3 days behind", "2 days behind", "1 day behind"],
            Enumerable.Range(0, 7).Select(Phrasing.ShiftAmount));
        Assert.Contains("in step", Phrasing.WeekdayShift(new Comparison(Day("2023-05-10"), CalendarSystemId.Ifc)));
        // Behind reads "behind the real one", not "behind of the real one".
        Assert.Equal("Fixed Friday, real Monday: the 13-month week runs 3 days behind the real one.",
            Phrasing.WeekdayShift(new Comparison(Day("2026-10-19"), CalendarSystemId.Positivist)));
    }

    [Fact]
    public void GregorianFirst()
    {
        var october19 = Day("2026-10-19");
        Assert.Equal("Monday, October 19, 2026. IFC Thursday, October 12, 2026",
            Phrasing.BothDates(october19, october19.ToThirteen(CalendarSystemId.Ifc)));
        Assert.Equal("Monday, October 19, 2026. Positivist Friday, Descartes 12, 238",
            Phrasing.BothDates(october19, october19.ToThirteen(CalendarSystemId.Positivist)));
        Assert.Equal("Thursday, December 31, 2026. IFC Year Day 2026, no weekday",
            Phrasing.BothDates(Day("2026-12-31"), Day("2026-12-31").ToThirteen(CalendarSystemId.Ifc)));
    }

    [Fact]
    public void ScreenReaderReadsBothDates()
    {
        Assert.Equal("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026",
            Phrasing.BothDates(Day("2026-10-19").ToThirteen(CalendarSystemId.Ifc), Day("2026-10-19")));
        Assert.Equal("Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024",
            Phrasing.BothDates(Day("2024-06-17").ToThirteen(CalendarSystemId.Ifc), Day("2024-06-17")));
    }

    [Fact]
    public void CopyHasNoDashes()
    {
        Assert.Equal("skipping 3 to 13 September.", Phrasing.WithoutDashes("skipping 3–13 September."));
        Assert.Equal("never, every 13th", Phrasing.WithoutDashes("never — every 13th"));
        Assert.Equal("calendar-reform", Phrasing.WithoutDashes("calendar—reform"));
        Assert.Equal("Plain text.", Phrasing.WithoutDashes("Plain text."));
        Assert.Equal("no match", Phrasing.DriftAmount(null));
    }

    [Fact]
    public void HistoryTextHasNoDashes()
    {
        var shell = new TestShell();
        var history = shell.Model.HistoryPage;
        var texts = history.Events.Select(e => e.Text)
            .Concat(history.Stories.SelectMany(s => new[] { s.Name, s.Summary, s.Origin }))
            .Append(history.Intro);
        foreach (var text in texts)
        {
            Assert.DoesNotContain('–', text);
            Assert.DoesNotContain('—', text);
        }
        Assert.Contains(history.Events, e => e.Text.Contains("skipping 3 to 13 September", StringComparison.Ordinal));
    }

    [Fact]
    public void PercentRoundsHalfAwayFromZero()
    {
        Assert.Equal("0%", Phrasing.Percent(0));
        Assert.Equal("100%", Phrasing.Percent(1));
        Assert.Equal("6.3%", Phrasing.Percent(0.0625));
        Assert.Equal("79.7%", Phrasing.Percent(291.0 / 365));
    }

    [Fact]
    public void DisplayYearsAndNotes()
    {
        Assert.Equal("238", Phrasing.DisplayYear(2026, CalendarSystemId.Positivist));
        Assert.Equal("2026", Phrasing.DisplayYear(2026, CalendarSystemId.Ifc));
        Assert.Null(Phrasing.GregorianYearNote(2026, CalendarSystemId.Ifc));
        Assert.Contains("2026", Phrasing.GregorianYearNote(2026, CalendarSystemId.Positivist));
    }

    [Fact]
    public void DatePlateEyebrowAndNames()
    {
        var plate = DatePlateModel.Create(new Comparison(Day("2026-10-19"), CalendarSystemId.Ifc));
        Assert.Equal("THURSDAY · MONTH 11 OF 13", plate.Eyebrow.Replace(' ', ' '));
        Assert.Equal("12", plate.Numeral);
        Assert.Equal("October", plate.Month);
        Assert.Equal("Monday, October 19, 2026", plate.SecondaryText);

        var leapDay = DatePlateModel.Create(new Comparison(Day("2024-06-17"), CalendarSystemId.Ifc));
        Assert.False(leapDay.IsNumeral);
        Assert.Equal("Leap Day", leapDay.IntercalaryName);
    }
}
